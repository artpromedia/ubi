/**
 * The driver's side: one server-composed schedule (handoff C1, decisions
 * correction 7) and the driver's own conflicts (C3).
 *
 * `GET /v1/drivers/me/schedule` combines what fleet-service owns (the
 * driver's availability and time off, signed shifts, maintenance on the
 * vehicles those shifts use) with the driver's OWN bookings, read from
 * ride-service's driver-entitled calendar (contract A route 6) — one owner
 * composing through a service-authenticated projection, never the client
 * merging two sources. Decisions come from the conflict rows.
 */
import { ContractError } from "@ubi/contracts";

import { availabilityOccurrences } from "./availability";
import { requireFleetEnabled } from "./config";
import { notFound } from "./errors";
import { shiftIntervals, shiftLabel } from "./shifts";
import { shiftOf, validToOf } from "./views";
import {
  DAY_MS,
  dateColumnToLocalDate,
  intersect,
  iso,
  mergeIntervals,
  type Interval,
} from "../lib/time";
import { isLiveBooking, type DriverBooking } from "../ports/ride-port";

import type { FleetDeps } from "./context";
import type { Actor } from "./types";
import type { ConflictStatus, ConflictType } from "../contract";
import type { FleetConflict } from "@prisma/client/index";

const MAX_RANGE_MS = 31 * DAY_MS;

function range(
  query: { from?: string | undefined; to?: string | undefined },
  now: Date,
): Interval {
  if (query.from !== undefined && query.to !== undefined) {
    const start = new Date(query.from).getTime();
    const end = new Date(query.to).getTime();
    if (!(end > start) || end - start > MAX_RANGE_MS) {
      throw new ContractError(
        "validation_failed",
        "the range must be positive and at most 31 days",
      );
    }
    return { start, end };
  }
  return { start: now.getTime(), end: now.getTime() + 7 * DAY_MS };
}

interface ConflictDetail {
  readonly bookingId?: string;
  readonly blockStartsAt?: string;
  readonly blockEndsAt?: string;
}

/**
 * The driver's own booking a conflict is about: by id when the conflict came
 * from the driver's time off, else by time — a fleet-side conflict names an
 * opaque block whose interval (buffers included) contains exactly one of the
 * driver's bookings (their bookings never overlap each other).
 */
function bookingForConflict(
  conflict: FleetConflict,
  bookings: readonly DriverBooking[],
): DriverBooking | null {
  const detail = (conflict.detail ?? {}) as ConflictDetail;
  if (detail.bookingId !== undefined) {
    return (
      bookings.find((booking) => booking.bookingId === detail.bookingId) ?? null
    );
  }
  if (detail.blockStartsAt === undefined || detail.blockEndsAt === undefined) {
    return null;
  }
  const start = new Date(detail.blockStartsAt).getTime();
  const end = new Date(detail.blockEndsAt).getTime();
  const inside = bookings.filter(
    (booking) =>
      new Date(booking.schedule.windowStart).getTime() >= start &&
      new Date(booking.schedule.windowEnd).getTime() <= end,
  );
  return inside.length === 1 ? (inside[0] ?? null) : null;
}

export async function driverSchedule(
  deps: FleetDeps,
  actor: Actor,
  cityId: string,
  query: { from?: string | undefined; to?: string | undefined },
) {
  const config = await requireFleetEnabled(deps.config, cityId);
  const now = deps.now();
  const window = range(query, now);
  const zone = config.city.timezone;
  const arrangements = await deps.db.fleetAssignment.findMany({
    where: { driverId: actor.id },
    include: { fleet: { select: { name: true } } },
  });
  const vehicles = await deps.db.vehicle.findMany({
    where: {
      id: { in: [...new Set(arrangements.map((row) => row.vehicleId))] },
    },
    select: { id: true, plateNumber: true },
  });
  const plateOf = new Map(
    vehicles.map((vehicle) => [vehicle.id, vehicle.plateNumber]),
  );
  const items: {
    itemId: string;
    kind: "availability" | "time_off" | "shift" | "maintenance" | "booking";
    startsAt: string;
    endsAt: string;
    label: string;
    vehicleId: string | null;
    bookingId: string | null;
    risk: "ok" | "at_risk" | null;
    decisionDeadline: string | null;
    conflictId: string | null;
  }[] = [];

  for (const occurrence of await availabilityOccurrences(
    deps,
    [actor.id],
    window,
  )) {
    items.push({
      itemId: `${occurrence.windowId}@${occurrence.start}`,
      kind: occurrence.kind === "time_off" ? "time_off" : "availability",
      startsAt: iso(occurrence.start),
      endsAt: iso(occurrence.end),
      label:
        occurrence.kind === "time_off"
          ? "Time off · only you can set this"
          : "Available · set by you",
      vehicleId: null,
      bookingId: null,
      risk: null,
      decisionDeadline: null,
      conflictId: null,
    });
  }

  const shiftTime = new Map<string, Interval[]>();
  for (const row of arrangements) {
    const intervals = shiftIntervals(
      shiftOf(row),
      row.zone,
      dateColumnToLocalDate(row.validFrom),
      validToOf(row.validTo),
      window,
    );
    shiftTime.set(row.vehicleId, [
      ...(shiftTime.get(row.vehicleId) ?? []),
      ...intervals,
    ]);
    for (const interval of intervals) {
      items.push({
        itemId: `${row.id}@${interval.start}`,
        kind: "shift",
        startsAt: iso(interval.start),
        endsAt: iso(interval.end),
        label: `${row.fleet.name} · ${plateOf.get(row.vehicleId) ?? "vehicle"} · ${shiftLabel(shiftOf(row))}`,
        vehicleId: row.vehicleId,
        bookingId: null,
        risk: null,
        decisionDeadline: null,
        conflictId: null,
      });
    }
  }

  const blocks = await deps.db.fleetMaintenanceBlock.findMany({
    where: {
      vehicleId: { in: [...shiftTime.keys()] },
      status: { in: ["scheduled", "active", "needs_resolution"] },
      startsAt: { lt: new Date(window.end) },
      OR: [{ endsAt: null }, { endsAt: { gt: new Date(window.start) } }],
    },
  });
  for (const block of blocks) {
    const interval = {
      start: block.startsAt.getTime(),
      end: block.endsAt?.getTime() ?? window.end,
    };
    const touches = mergeIntervals(shiftTime.get(block.vehicleId) ?? []).some(
      (shift) => intersect(shift, interval) !== null,
    );
    if (!touches) {
      continue;
    }
    const clipped = intersect(interval, window);
    if (clipped === null) {
      continue;
    }
    items.push({
      itemId: block.id,
      kind: "maintenance",
      startsAt: iso(clipped.start),
      endsAt: iso(clipped.end),
      label: `Vehicle ${plateOf.get(block.vehicleId) ?? ""} in service`.replace(
        "  ",
        " ",
      ),
      vehicleId: block.vehicleId,
      bookingId: null,
      risk: null,
      decisionDeadline: null,
      conflictId: null,
    });
  }

  const conflicts = await deps.db.fleetConflict.findMany({
    where: { driverId: actor.id, status: { in: ["open", "resolving"] } },
    orderBy: { deadlineAt: "asc" },
  });
  const bookings = (
    await deps.rides.driverCalendar(
      actor.id,
      iso(window.start),
      iso(window.end),
    )
  ).filter((booking) => isLiveBooking(booking));
  for (const booking of bookings) {
    const conflict = conflicts.find(
      (candidate) =>
        bookingForConflict(candidate, bookings)?.bookingId ===
        booking.bookingId,
    );
    items.push({
      itemId: booking.bookingId,
      kind: "booking",
      startsAt: booking.schedule.windowStart,
      endsAt: booking.schedule.windowEnd,
      label: `${booking.schedule.label} · ${booking.statusLabel}`,
      vehicleId: null,
      bookingId: booking.bookingId,
      risk: conflict === undefined ? "ok" : "at_risk",
      decisionDeadline:
        conflict?.deadlineAt === null || conflict === undefined
          ? null
          : iso(conflict.deadlineAt.getTime()),
      conflictId: conflict?.id ?? null,
    });
  }
  items.sort(
    (a, b) =>
      a.startsAt.localeCompare(b.startsAt) || a.kind.localeCompare(b.kind),
  );
  return {
    zone,
    asOf: iso(now.getTime()),
    from: iso(window.start),
    to: iso(window.end),
    items,
    alerts: conflicts
      .filter((conflict) => conflict.resolverRoles.includes("driver"))
      .map((conflict) => ({
        conflictId: conflict.id,
        type: conflict.type as ConflictType,
        deadlineAt:
          conflict.deadlineAt === null
            ? null
            : iso(conflict.deadlineAt.getTime()),
      })),
  };
}

/** A driver's own conflict, with the choices and their server-explained outcomes. */
export async function driverConflict(
  deps: FleetDeps,
  actor: Actor,
  cityId: string,
  conflictId: string,
) {
  await requireFleetEnabled(deps.config, cityId);
  const conflict = await deps.db.fleetConflict.findUnique({
    where: { id: conflictId },
  });
  if (conflict === null || conflict.driverId !== actor.id) {
    throw notFound("conflict");
  }
  const now = deps.now();
  let bookings: DriverBooking[] = [];
  try {
    bookings = await deps.rides.driverCalendar(
      actor.id,
      iso(now.getTime() - DAY_MS),
      iso(now.getTime() + 120 * DAY_MS),
    );
  } catch {
    bookings = [];
  }
  const booking = bookingForConflict(conflict, bookings);
  const outcome =
    booking === null
      ? null
      : {
          commissionReturned: booking.commissionMinor ?? null,
          fundingReleased: true as const,
          rematch: "decided_by_marketplace" as const,
          penalty: "none" as const,
        };
  const withdraw = {
    id: "withdraw" as const,
    enabled: booking !== null,
    reason:
      booking === null
        ? "The booking could not be matched right now; open it from your calendar."
        : null,
    outcome,
    next:
      booking === null
        ? null
        : {
            method: "POST",
            path: `/v1/mp/advance-bookings/${booking.bookingId}/withdraw`,
          },
  };
  const type = conflict.type as ConflictType;
  const options =
    type === "time_off_overlaps_booking"
      ? [
          {
            id: "trim_time_off" as const,
            enabled: true,
            reason: null,
            outcome: null,
            next: { method: "PUT", path: "/v1/drivers/me/availability" },
          },
          withdraw,
        ]
      : [
          await swapOption(deps, conflict),
          {
            id: "ask_fleet_to_move" as const,
            enabled: type === "maintenance_overlaps_booking",
            reason:
              type === "maintenance_overlaps_booking"
                ? null
                : "Only planned maintenance can be moved; this blocker is not the fleet's to move.",
            outcome: null,
            next: null,
          },
          withdraw,
        ];
  return {
    conflictId: conflict.id,
    type,
    severity: conflict.severity as
      | "critical"
      | "high"
      | "medium"
      | "blocked"
      | "status",
    status: conflict.status as ConflictStatus,
    deadlineAt:
      conflict.deadlineAt === null ? null : iso(conflict.deadlineAt.getTime()),
    bookingId: booking?.bookingId ?? null,
    vehicleId: conflict.vehicleId,
    options,
  };
}

/** "Keep it on another vehicle": only when the fleet has an eligible one. */
async function swapOption(deps: FleetDeps, conflict: FleetConflict) {
  const fleetVehicles =
    conflict.fleetId === null
      ? []
      : await deps.db.fleetVehicle.findMany({
          where: { fleetId: conflict.fleetId, status: "active" },
          include: { vehicle: true },
        });
  const from = fleetVehicles.find(
    (row) => row.vehicleId === conflict.vehicleId,
  );
  const now = deps.now();
  const candidates = fleetVehicles.filter(
    (row) =>
      from !== undefined &&
      row.vehicleId !== from.vehicleId &&
      from.classes.every((cls) => row.classes.includes(cls)) &&
      row.capacity >= from.capacity &&
      row.vehicle.insuranceExpiry !== null &&
      row.vehicle.inspectionExpiry !== null &&
      row.vehicle.insuranceExpiry > now &&
      row.vehicle.inspectionExpiry > now,
  );
  return {
    id: "keep_on_swapped_vehicle" as const,
    enabled: candidates.length > 0,
    reason:
      candidates.length > 0
        ? "Your fleet proposes the vehicle; you accept it, then the rider confirms."
        : "No eligible vehicle: none with the same class and capacity and valid documents.",
    outcome: null,
    next: null,
  };
}
