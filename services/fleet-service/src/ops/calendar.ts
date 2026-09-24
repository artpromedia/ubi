/**
 * The fleet calendar (handoff B1-B4, B8; FL-6, FL-7) — composed on the
 * server from fleet-owned facts and ride-service's fleet-safe projection.
 *
 * Layers, highest precedence first (handoff "Availability model"):
 *   1 UBI status (doc_expired, suspended — status only)
 *   2 marketplace commitments — ride-service OccupiedBlocks (contract A
 *     route 5), time + risk only, buffers included
 *   3 driver time off — shown to the fleet ONLY as `unavailable`
 *   4 maintenance blocks
 *   5 signed assignments / shifts (expanded to real intervals in the zone)
 *   6 driver availability windows (driver rows, read-only)
 *   7 proposals — never shown as availability (not on the calendar at all)
 *
 * Every block is a projection built from named fields; the route parses the
 * whole response through FleetCalendarSchema on the way out. If the booking
 * layer is requested and ride-service cannot answer, the calendar answers
 * 503 rather than an empty booking lane a fleet could mistake for "free".
 */
import { ContractError } from "@ubi/contracts";

import { availabilityOccurrences } from "./availability";
import { shiftIntervals, shiftLabel } from "./shifts";
import { arrangementsOn, availabilityNow, MONEY_UNAVAILABLE } from "./vehicles";
import {
  displayNames,
  documentStatuses,
  maintenanceView,
  nameOr,
  shiftOf,
  validToOf,
} from "./views";
import {
  DAY_MS,
  addDays,
  compareDates,
  dateColumnToLocalDate,
  hours2dp,
  intersect,
  iso,
  localDateOf,
  localDateToDateColumn,
  mergeIntervals,
  startOfLocalDay,
  totalMs,
  type Interval,
} from "../lib/time";

import type { FleetDeps } from "./context";
import type { FleetAccess } from "./roles";
import type { OccupiedBlock } from "../contract";
import type {
  FleetAssignment,
  FleetMaintenanceBlock,
  FleetVehicle,
  Vehicle,
} from "@prisma/client/index";

export const CALENDAR_LAYERS = [
  "assignments",
  "maintenance",
  "bookings",
  "documents",
] as const;
export type CalendarLayer = (typeof CALENDAR_LAYERS)[number];

export interface CalendarQuery {
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  readonly zoom: "day" | "week";
  readonly rows: "vehicles" | "drivers";
  readonly layers: readonly CalendarLayer[];
  readonly vehicleClass?: string | undefined;
  readonly status?: string | undefined;
  readonly conflictsOnly: boolean;
  readonly q?: string | undefined;
  readonly cursor?: string | undefined;
  readonly limit: number;
  /** Internal: restrict to one vehicle (vehicle detail). */
  readonly vehicleId?: string | undefined;
}

const MAX_RANGE_MS = 31 * DAY_MS;

/** The requested range, or the zoom's default in the fleet's zone. */
export function calendarRange(
  query: Pick<CalendarQuery, "from" | "to" | "zoom">,
  zone: string,
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
  const today = localDateOf(now.getTime(), zone);
  if (query.zoom === "day") {
    return {
      start: startOfLocalDay(today, zone),
      end: startOfLocalDay(addDays(today, 1), zone),
    };
  }
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  const monday = addDays(today, -((weekday + 6) % 7));
  return {
    start: startOfLocalDay(monday, zone),
    end: startOfLocalDay(addDays(monday, 7), zone),
  };
}

function decodeCursor(cursor: string | undefined): number {
  if (cursor === undefined) {
    return 0;
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as { o?: unknown };
    return typeof parsed.o === "number" &&
      Number.isInteger(parsed.o) &&
      parsed.o >= 0
      ? parsed.o
      : 0;
  } catch {
    throw new ContractError("validation_failed", "the cursor is not valid");
  }
}

function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset }), "utf8").toString(
    "base64url",
  );
}

function blockInterval(block: OccupiedBlock): Interval {
  return {
    start: new Date(block.startsAt).getTime(),
    end: new Date(block.endsAt).getTime(),
  };
}

function maintenanceInterval(
  block: FleetMaintenanceBlock,
  now: number,
): Interval {
  return {
    start: block.startsAt.getTime(),
    end:
      block.endsAt?.getTime() ??
      Math.max(now, block.startsAt.getTime()) + DAY_MS,
  };
}

function arrangementIntervals(
  row: FleetAssignment,
  window: Interval,
): Interval[] {
  return shiftIntervals(
    shiftOf(row),
    row.zone,
    dateColumnToLocalDate(row.validFrom),
    validToOf(row.validTo),
    window,
  );
}

type VehicleRow = FleetVehicle & { vehicle: Vehicle };

export async function fleetCalendar(
  deps: FleetDeps,
  access: FleetAccess,
  query: CalendarQuery,
) {
  const now = deps.now();
  const zone = access.fleet.zone;
  const range = calendarRange(query, zone, now);
  const layers = new Set(
    query.layers.length === 0 ? CALENDAR_LAYERS : query.layers,
  );
  const fromDate = localDateOf(range.start, zone);
  const toDate = localDateOf(range.end - 1, zone);

  const arrangements = await deps.db.fleetAssignment.findMany({
    where: {
      fleetId: access.fleet.id,
      validFrom: { lte: localDateToDateColumn(addDays(toDate, 1)) },
      OR: [
        { validTo: null },
        { validTo: { gte: localDateToDateColumn(addDays(fromDate, -1)) } },
      ],
    },
    orderBy: { signedAt: "asc" },
  });
  const inWindow = arrangements
    .map((row) => ({ row, intervals: arrangementIntervals(row, range) }))
    .filter((entry) => entry.intervals.length > 0);
  const openConflicts = await deps.db.fleetConflict.findMany({
    where: { fleetId: access.fleet.id, status: { in: ["open", "resolving"] } },
  });
  const names = await displayNames(
    deps.db,
    inWindow.map((entry) => entry.row.driverId),
  );

  if (query.rows === "vehicles") {
    return vehicleRowsCalendar(
      deps,
      access,
      query,
      range,
      layers,
      inWindow,
      openConflicts,
      names,
      now,
    );
  }
  return driverRowsCalendar(
    deps,
    access,
    query,
    range,
    layers,
    inWindow,
    openConflicts,
    names,
    now,
  );
}

async function vehicleRowsCalendar(
  deps: FleetDeps,
  access: FleetAccess,
  query: CalendarQuery,
  range: Interval,
  layers: ReadonlySet<CalendarLayer>,
  inWindow: { row: FleetAssignment; intervals: Interval[] }[],
  openConflicts: { vehicleId: string | null; driverId: string | null }[],
  names: Map<string, string>,
  now: Date,
) {
  const all: VehicleRow[] = await deps.db.fleetVehicle.findMany({
    where: {
      fleetId: access.fleet.id,
      status: "active",
      ...(query.vehicleId === undefined ? {} : { vehicleId: query.vehicleId }),
    },
    include: { vehicle: true },
  });
  const blocks = await deps.db.fleetMaintenanceBlock.findMany({
    where: {
      fleetId: access.fleet.id,
      status: { not: "cancelled" },
      startsAt: { lt: new Date(range.end) },
      OR: [
        { endsAt: null },
        { endsAt: { gt: new Date(Math.min(range.start, now.getTime())) } },
      ],
    },
    orderBy: { startsAt: "asc" },
  });
  // statusNow is about NOW, whatever range the calendar shows.
  const today = localDateOf(now.getTime(), access.fleet.zone);
  const assignedToday = new Set(
    (await arrangementsOn(deps.db, { fleetId: access.fleet.id }, today)).map(
      (row) => row.vehicleId,
    ),
  );
  const heldNow = await deps.db.fleetMaintenanceBlock.findMany({
    where: {
      fleetId: access.fleet.id,
      status: { in: ["scheduled", "active"] },
      startsAt: { lte: now },
      OR: [{ endsAt: null }, { endsAt: { gt: now } }],
    },
  });
  const statusOf = (row: VehicleRow) =>
    availabilityNow({
      vehicle: row.vehicle,
      now,
      policy: access.config.policy,
      maintenance: heldNow.filter((block) => block.vehicleId === row.vehicleId),
      assigned: assignedToday.has(row.vehicleId),
    });
  const needle = query.q?.trim().toUpperCase();
  const filtered = all
    .filter(
      (row) =>
        query.vehicleClass === undefined ||
        row.classes.includes(query.vehicleClass),
    )
    .filter(
      (row) =>
        needle === undefined ||
        needle.length === 0 ||
        row.vehicle.plateNumber.includes(needle),
    )
    .filter(
      (row) => query.status === undefined || statusOf(row) === query.status,
    )
    .filter(
      (row) =>
        !query.conflictsOnly ||
        openConflicts.some((conflict) => conflict.vehicleId === row.vehicleId),
    )
    .sort((a, b) =>
      a.vehicle.plateNumber === b.vehicle.plateNumber
        ? a.vehicleId.localeCompare(b.vehicleId)
        : a.vehicle.plateNumber.localeCompare(b.vehicle.plateNumber),
    );
  const offset = decodeCursor(query.cursor);
  const page = filtered.slice(offset, offset + query.limit);
  const nextCursor =
    offset + page.length < filtered.length
      ? encodeCursor(offset + page.length)
      : null;

  const pageVehicleIds = page.map((row) => row.vehicleId);
  const pageArrangements = inWindow.filter((entry) =>
    pageVehicleIds.includes(entry.row.vehicleId),
  );
  let occupied: OccupiedBlock[] = [];
  if (layers.has("bookings") && page.length > 0) {
    occupied = await deps.rides.occupiedBlocks({
      vehicleIds: pageVehicleIds,
      driverIds: [
        ...new Set(pageArrangements.map((entry) => entry.row.driverId)),
      ],
      from: iso(range.start),
      to: iso(range.end),
    });
  }

  const rows = page.map((row) => {
    const mine = pageArrangements.filter(
      (entry) => entry.row.vehicleId === row.vehicleId,
    );
    const ownBlocks = occupied.filter((block) => {
      if (block.vehicleId !== null) {
        return block.vehicleId === row.vehicleId;
      }
      // A booking with no vehicle recorded belongs to the vehicle whose
      // signed shift covers the driver at the booking's start.
      const at = blockInterval(block).start;
      return mine.some(
        (entry) =>
          entry.row.driverId === block.driverId &&
          entry.intervals.some(
            (interval) => interval.start <= at && at < interval.end,
          ),
      );
    });
    const vehicleBlocks = blocks.filter(
      (block) => block.vehicleId === row.vehicleId,
    );
    const docs = documentStatuses(row.vehicle, now, access.config.policy);
    const statusNow = statusOf(row);
    const flags = new Set<string>();
    if (
      openConflicts.some((conflict) => conflict.vehicleId === row.vehicleId)
    ) {
      flags.add("conflict");
    }
    if (docs.some((doc) => doc.status === "expiring")) {
      flags.add("doc_expiring");
    }
    if (docs.some((doc) => doc.status === "expired")) {
      flags.add("doc_expired");
    }
    if (docs.some((doc) => doc.status === "missing")) {
      flags.add("documents_pending");
    }
    if (ownBlocks.some((block) => block.risk === "at_risk")) {
      flags.add("at_risk");
    }
    if (vehicleBlocks.some((block) => block.offRoadFlaggedAt !== null)) {
      flags.add("off_road_flagged");
    }
    const expired = docs.filter(
      (doc) => doc.status === "expired" && doc.expiresAt !== null,
    );
    return {
      rowId: row.vehicleId,
      rowKind: "vehicle" as const,
      vehicleId: row.vehicleId,
      driverId: null,
      label: row.vehicle.plateNumber,
      statusNow,
      flags: [...flags],
      assignments: layers.has("assignments")
        ? mine.map((entry) => ({
            assignmentId: entry.row.id,
            vehicleId: entry.row.vehicleId,
            driverId: entry.row.driverId,
            driverDisplayName: nameOr(names, entry.row.driverId),
            shift: shiftOf(entry.row),
            termsVersion: entry.row.termsVersion,
            status: entry.row.status as
              | "active"
              | "notice"
              | "ended"
              | "superseded",
            intervals: entry.intervals.map((interval) => ({
              startsAt: iso(interval.start),
              endsAt: iso(interval.end),
            })),
          }))
        : [],
      maintenance: layers.has("maintenance")
        ? vehicleBlocks
            .filter(
              (block) =>
                intersect(maintenanceInterval(block, now.getTime()), range) !==
                null,
            )
            .map((block) => maintenanceView(block))
        : [],
      occupied: layers.has("bookings") ? ownBlocks : [],
      documents: layers.has("documents") ? docs : [],
      ubiStatus:
        expired.length === 0
          ? null
          : {
              subject: "vehicle" as const,
              subjectId: row.vehicleId,
              status: "doc_expired" as const,
              effectiveFrom:
                expired.map((doc) => doc.expiresAt as string).sort()[0] ?? null,
              effectiveTo: null,
            },
      availability: null,
      hours: {
        signedShiftHours: hours2dp(
          totalMs(mine.flatMap((entry) => entry.intervals)),
        ),
      },
    };
  });

  return {
    zone: access.fleet.zone,
    asOf: iso(now.getTime()),
    from: iso(range.start),
    to: iso(range.end),
    zoom: query.zoom,
    rowsKind: "vehicles" as const,
    layers: [...layers],
    rows,
    daySummaries:
      query.zoom === "week"
        ? daySummaries(rows, range, access.fleet.zone)
        : null,
    nextCursor,
    totalRows: filtered.length,
  };
}

async function driverRowsCalendar(
  deps: FleetDeps,
  access: FleetAccess,
  query: CalendarQuery,
  range: Interval,
  layers: ReadonlySet<CalendarLayer>,
  inWindow: { row: FleetAssignment; intervals: Interval[] }[],
  openConflicts: { vehicleId: string | null; driverId: string | null }[],
  names: Map<string, string>,
  now: Date,
) {
  const needle = query.q?.trim().toLowerCase();
  const driverIds = [...new Set(inWindow.map((entry) => entry.row.driverId))]
    .filter(
      (id) =>
        needle === undefined ||
        needle.length === 0 ||
        nameOr(names, id).toLowerCase().includes(needle),
    )
    .filter(
      (id) =>
        !query.conflictsOnly ||
        openConflicts.some((conflict) => conflict.driverId === id),
    )
    .sort(
      (a, b) =>
        nameOr(names, a).localeCompare(nameOr(names, b)) || a.localeCompare(b),
    );
  const offset = decodeCursor(query.cursor);
  const page = driverIds.slice(offset, offset + query.limit);
  const nextCursor =
    offset + page.length < driverIds.length
      ? encodeCursor(offset + page.length)
      : null;
  const vehicleIds = [
    ...new Set(
      inWindow
        .filter((entry) => page.includes(entry.row.driverId))
        .map((entry) => entry.row.vehicleId),
    ),
  ];
  const blocks = await deps.db.fleetMaintenanceBlock.findMany({
    where: {
      vehicleId: { in: vehicleIds },
      status: { not: "cancelled" },
      startsAt: { lt: new Date(range.end) },
      OR: [{ endsAt: null }, { endsAt: { gt: new Date(range.start) } }],
    },
  });
  let occupied: OccupiedBlock[] = [];
  if (layers.has("bookings") && page.length > 0) {
    occupied = await deps.rides.occupiedBlocks({
      vehicleIds: [],
      driverIds: page,
      from: iso(range.start),
      to: iso(range.end),
    });
  }
  const availability = await availabilityOccurrences(deps, page, range);
  const users = await deps.db.user.findMany({
    where: { id: { in: page.filter((id) => /^[0-9a-f-]{36}$/i.test(id)) } },
    select: { id: true, status: true },
  });
  const suspended = new Set(
    users.filter((user) => user.status === "SUSPENDED").map((user) => user.id),
  );

  const rows = page.map((driverId) => {
    const mine = inWindow.filter((entry) => entry.row.driverId === driverId);
    const shiftTime = mergeIntervals(mine.flatMap((entry) => entry.intervals));
    const myVehicles = new Set(mine.map((entry) => entry.row.vehicleId));
    const flags = new Set<string>();
    if (openConflicts.some((conflict) => conflict.driverId === driverId)) {
      flags.add("conflict");
    }
    const own = occupied.filter((block) => block.driverId === driverId);
    if (own.some((block) => block.risk === "at_risk")) {
      flags.add("at_risk");
    }
    return {
      rowId: driverId,
      rowKind: "driver" as const,
      vehicleId: null,
      driverId,
      label: nameOr(names, driverId),
      statusNow: null,
      flags: [...flags],
      assignments: layers.has("assignments")
        ? mine.map((entry) => ({
            assignmentId: entry.row.id,
            vehicleId: entry.row.vehicleId,
            driverId,
            driverDisplayName: nameOr(names, driverId),
            shift: shiftOf(entry.row),
            termsVersion: entry.row.termsVersion,
            status: entry.row.status as
              | "active"
              | "notice"
              | "ended"
              | "superseded",
            intervals: entry.intervals.map((interval) => ({
              startsAt: iso(interval.start),
              endsAt: iso(interval.end),
            })),
          }))
        : [],
      maintenance: layers.has("maintenance")
        ? blocks
            .filter((block) => myVehicles.has(block.vehicleId))
            .filter((block) =>
              shiftTime.some(
                (interval) =>
                  intersect(
                    interval,
                    maintenanceInterval(block, now.getTime()),
                  ) !== null,
              ),
            )
            .map((block) => maintenanceView(block))
        : [],
      occupied: layers.has("bookings") ? own : [],
      documents: [],
      ubiStatus: suspended.has(driverId)
        ? {
            subject: "driver" as const,
            subjectId: driverId,
            status: "suspended" as const,
            effectiveFrom: null,
            effectiveTo: null,
          }
        : null,
      // Set by the driver, read-only here; time off is only "unavailable".
      availability: availability
        .filter((entry) => entry.driverId === driverId)
        .map((entry) => ({
          kind:
            entry.kind === "time_off"
              ? ("unavailable" as const)
              : ("available" as const),
          startsAt: iso(entry.start),
          endsAt: iso(entry.end),
          setBy: "driver" as const,
        })),
      hours: { signedShiftHours: hours2dp(totalMs(shiftTime)) },
    };
  });
  return {
    zone: access.fleet.zone,
    asOf: iso(now.getTime()),
    from: iso(range.start),
    to: iso(range.end),
    zoom: query.zoom,
    rowsKind: "drivers" as const,
    layers: [...layers],
    rows,
    daySummaries:
      query.zoom === "week"
        ? daySummaries(rows, range, access.fleet.zone)
        : null,
    nextCursor,
    totalRows: driverIds.length,
  };
}

function daySummaries(
  rows: readonly {
    rowId: string;
    flags: string[];
    assignments: {
      shift: {
        kind: "full" | "day" | "night" | "custom";
        start: string;
        end: string;
      };
      intervals: { startsAt: string; endsAt: string }[];
    }[];
    maintenance: { startsAt: string; endsAt: string | null }[];
    occupied: OccupiedBlock[];
  }[],
  range: Interval,
  zone: string,
) {
  const out = [];
  let date = localDateOf(range.start, zone);
  const last = localDateOf(range.end - 1, zone);
  let guard = 0;
  while (compareDates(date, last) <= 0 && guard < 40) {
    guard += 1;
    const day = {
      start: startOfLocalDay(date, zone),
      end: startOfLocalDay(addDays(date, 1), zone),
    };
    for (const row of rows) {
      const booked = row.occupied.filter((block) => {
        const start = new Date(block.startsAt).getTime();
        return start >= day.start && start < day.end;
      });
      const shifts = row.assignments
        .filter((assignment) =>
          assignment.intervals.some(
            (interval) =>
              new Date(interval.startsAt).getTime() < day.end &&
              day.start < new Date(interval.endsAt).getTime(),
          ),
        )
        .map((assignment) => shiftLabel(assignment.shift));
      const maintenance = row.maintenance.filter(
        (block) =>
          new Date(block.startsAt).getTime() < day.end &&
          (block.endsAt === null ||
            day.start < new Date(block.endsAt).getTime()),
      );
      const flags = new Set<string>();
      if (booked.some((block) => block.risk === "at_risk")) {
        flags.add("at_risk");
      }
      if (maintenance.length > 0) {
        flags.add("maintenance");
      }
      out.push({
        date,
        rowId: row.rowId,
        bookedCount: booked.length,
        shiftSummary: [...new Set(shifts)],
        maintenanceCount: maintenance.length,
        flags: [...flags],
      });
    }
    date = addDays(date, 1);
  }
  return out;
}

// ── Utilisation (B8) and overview ──────────────────────────────────────────

const DEFINITIONS = {
  onTrip: "Hours the vehicle carried a trip (ride-service trip history).",
  onlineIdle: "Hours a driver was online in the vehicle without a trip.",
  bookedAhead:
    "Hours of confirmed advance bookings still ahead in the range, buffers included (ride-service's fleet-safe projection).",
  maintenance: "Hours inside maintenance or off-road blocks (fleet-service).",
  offline: "Hours with no driver online in the vehicle.",
};

export async function utilisation(
  deps: FleetDeps,
  access: FleetAccess,
  query: { from?: string | undefined; to?: string | undefined },
) {
  const now = deps.now();
  const range =
    query.from !== undefined && query.to !== undefined
      ? calendarRange(
          { from: query.from, to: query.to, zoom: "week" },
          access.fleet.zone,
          now,
        )
      : { start: now.getTime() - 7 * DAY_MS, end: now.getTime() };
  const vehicles = await deps.db.fleetVehicle.findMany({
    where: { fleetId: access.fleet.id, status: "active" },
    include: { vehicle: true },
    orderBy: { createdAt: "asc" },
  });
  const minMs = access.config.policy.utilisationMinDays * DAY_MS;
  const eligible = vehicles.filter(
    (row) => now.getTime() - row.createdAt.getTime() >= minMs,
  );
  const blocks = await deps.db.fleetMaintenanceBlock.findMany({
    where: {
      vehicleId: { in: eligible.map((row) => row.vehicleId) },
      status: { in: ["scheduled", "active", "completed"] },
      startsAt: { lt: new Date(range.end) },
    },
  });
  const ahead = { start: Math.max(range.start, now.getTime()), end: range.end };
  let occupied: OccupiedBlock[] = [];
  if (eligible.length > 0 && ahead.end > ahead.start) {
    occupied = await deps.rides.occupiedBlocks({
      vehicleIds: eligible.map((row) => row.vehicleId),
      driverIds: [],
      from: iso(ahead.start),
      to: iso(ahead.end),
    });
  }
  const unavailable = [
    {
      metric: "onTrip",
      reason: "no per-vehicle trip-hours history is available to fleet-service",
      dependency:
        "ride-service: an internal per-vehicle trip-hours aggregate (not in contract A)",
    },
    {
      metric: "onlineIdle",
      reason:
        "no driver online-session history exists (only the current online flag)",
      dependency:
        "ride-service / location-service: driver online-session history per vehicle",
    },
    {
      metric: "offline",
      reason:
        "offline hours are the complement of online hours, which have no source yet",
      dependency:
        "ride-service / location-service: driver online-session history per vehicle",
    },
  ];
  return {
    asOf: iso(now.getTime()),
    zone: access.fleet.zone,
    from: iso(range.start),
    to: iso(range.end),
    definitions: DEFINITIONS,
    rows: vehicles.map((row) => {
      const enoughData = now.getTime() - row.createdAt.getTime() >= minMs;
      if (!enoughData) {
        return {
          vehicleId: row.vehicleId,
          plate: row.vehicle.plateNumber,
          addedAt: iso(row.createdAt.getTime()),
          enoughData: false,
          reason: "not_enough_data" as const,
          hours: null,
          unavailable: [],
        };
      }
      const maintenance = mergeIntervals(
        blocks
          .filter((block) => block.vehicleId === row.vehicleId)
          // An open-ended breakdown counts until now, never beyond.
          .map((block) => ({
            start: block.startsAt.getTime(),
            end: block.endsAt?.getTime() ?? now.getTime(),
          }))
          .map((interval) => intersect(interval, range))
          .filter((interval): interval is Interval => interval !== null),
      );
      const booked = mergeIntervals(
        occupied
          .filter(
            (block) =>
              block.vehicleId === row.vehicleId && block.kind === "booked",
          )
          .map((block) => intersect(blockInterval(block), ahead))
          .filter((interval): interval is Interval => interval !== null),
      );
      return {
        vehicleId: row.vehicleId,
        plate: row.vehicle.plateNumber,
        addedAt: iso(row.createdAt.getTime()),
        enoughData: true,
        reason: null,
        hours: {
          onTrip: null,
          onlineIdle: null,
          bookedAhead: hours2dp(totalMs(booked)),
          maintenance: hours2dp(totalMs(maintenance)),
          offline: null,
        },
        unavailable,
      };
    }),
  };
}

export async function overview(deps: FleetDeps, access: FleetAccess) {
  const now = deps.now();
  const today = localDateOf(now.getTime(), access.fleet.zone);
  const [vehicles, arrangements, pending, conflicts, blocks] =
    await Promise.all([
      deps.db.fleetVehicle.findMany({
        where: { fleetId: access.fleet.id, status: "active" },
        include: { vehicle: true },
      }),
      deps.db.fleetAssignment.findMany({
        where: {
          fleetId: access.fleet.id,
          status: { in: ["active", "notice"] },
          OR: [
            { validTo: null },
            { validTo: { gt: localDateToDateColumn(today) } },
          ],
        },
      }),
      deps.db.fleetAssignmentProposal.count({
        where: {
          fleetId: access.fleet.id,
          status: "pending_signature",
          expiresAt: { gt: now },
        },
      }),
      deps.db.fleetConflict.findMany({
        where: {
          fleetId: access.fleet.id,
          status: { in: ["open", "resolving"] },
        },
        select: { severity: true },
      }),
      deps.db.fleetMaintenanceBlock.findMany({
        where: {
          fleetId: access.fleet.id,
          status: { in: ["scheduled", "active"] },
        },
      }),
    ]);
  const docs = vehicles.map((row) =>
    documentStatuses(row.vehicle, now, access.config.policy),
  );
  const count = (severity: string) =>
    conflicts.filter((conflict) => conflict.severity === severity).length;
  return {
    fleetId: access.fleet.id,
    asOf: iso(now.getTime()),
    zone: access.fleet.zone,
    vehicles: {
      total: vehicles.length,
      docExpiring: docs.filter((set) =>
        set.some((doc) => doc.status === "expiring"),
      ).length,
      docExpired: docs.filter((set) =>
        set.some((doc) => doc.status === "expired"),
      ).length,
      inMaintenance: vehicles.filter((row) =>
        blocks.some(
          (block) =>
            block.vehicleId === row.vehicleId &&
            block.startsAt <= now &&
            (block.endsAt === null || block.endsAt > now),
        ),
      ).length,
    },
    arrangements: {
      active: arrangements.filter((row) => row.status === "active").length,
      onNotice: arrangements.filter((row) => row.status === "notice").length,
      pendingProposals: pending,
    },
    openConflicts: {
      critical: count("critical"),
      high: count("high"),
      medium: count("medium"),
      status: count("status"),
    },
    money: MONEY_UNAVAILABLE,
  };
}
