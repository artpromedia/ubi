/**
 * Fleet vehicles.
 *
 * A vehicle is the shared `vehicles` row (the id ride-service records on
 * bookings and occupancy); `fleet_vehicles` places it in a fleet with its
 * classes and capacity, and the database keeps a vehicle in at most one
 * active fleet. Adding a NEW plate creates the vehicle row with no document
 * expiries — "documents pending" until UBI verifies them. An already
 * registered plate is refused: moving a vehicle someone else registered into
 * a fleet needs ownership checks UBI ops own (KYB is out of scope here).
 *
 * Document status is UBI's (vehicles.insurance_expiry / inspection_expiry):
 * a fleet reads it and is warned about it, but never writes it.
 */
import { ContractError } from "@ubi/contracts";

import { isUniqueViolation, notFound, exclusionConstraintOf } from "./errors";
import { withOutbox } from "./outbox";
import { assertCapability, type FleetAccess } from "./roles";
import { shiftIntervals } from "./shifts";
import {
  displayNames,
  documentStatuses,
  nameOr,
  shiftOf,
  termsOf,
  validToOf,
} from "./views";
import { deterministicId, isUuid } from "../lib/ids";
import {
  addDays,
  dateColumnToLocalDate,
  hours2dp,
  intersectAll,
  iso,
  isoWeekday,
  localDateOf,
  localDateToDateColumn,
  mergeIntervals,
  startOfLocalDay,
  totalMs,
  type Interval,
} from "../lib/time";
import { summaryToFleetMoney } from "../ports/payment-port";

import type { FleetDeps } from "./context";
import type { FleetTx } from "./types";
import type {
  FleetPolicy,
  FleetRemittanceAssignmentRow,
  FleetRemittanceStatement,
  FleetWeekMoneyAssignmentInput,
  FleetWeekMoneyResponse,
} from "../contract";
import type {
  FleetMaintenanceBlock,
  FleetVehicle,
  Vehicle,
} from "@prisma/client/index";

export type VehicleAvailabilityNow =
  | "in_service"
  | "maintenance"
  | "doc_expired"
  | "held_by_ubi"
  | "unassigned"
  | "documents_pending";

/** The money a fleet portal shows is payment-service's; never computed here. */
export const MONEY_UNAVAILABLE = {
  available: false as const,
  reason:
    "gross, UBI commission and remittance are settled by payment-service; fleet-service never computes money",
  source: "payment-service remittance settlement (internal contract B)",
};

export interface AddVehicleInput {
  readonly plate: string;
  readonly make: string;
  readonly model: string;
  readonly year: number;
  readonly color: string;
  readonly type: "SEDAN" | "SUV" | "VAN" | "MOTORCYCLE" | "ELECTRIC";
  readonly capacity: number;
  readonly classes: readonly string[];
}

export function normalisePlate(plate: string): string {
  return plate.trim().toUpperCase().replace(/\s+/g, " ");
}

/** Active signed arrangements whose validity covers `date` (local). */
export async function arrangementsOn(
  db: FleetTx,
  where: {
    fleetId?: string;
    vehicleIds?: readonly string[];
    driverId?: string;
  },
  date: string,
) {
  const day = localDateToDateColumn(date);
  const rows = await db.fleetAssignment.findMany({
    where: {
      ...(where.fleetId === undefined ? {} : { fleetId: where.fleetId }),
      ...(where.vehicleIds === undefined
        ? {}
        : { vehicleId: { in: [...where.vehicleIds] } }),
      ...(where.driverId === undefined ? {} : { driverId: where.driverId }),
      validFrom: { lte: day },
      OR: [{ validTo: null }, { validTo: { gt: day } }],
    },
    orderBy: { signedAt: "asc" },
  });
  return rows;
}

export function availabilityNow(input: {
  readonly vehicle: Pick<Vehicle, "insuranceExpiry" | "inspectionExpiry">;
  readonly now: Date;
  readonly policy: FleetPolicy;
  readonly maintenance: readonly FleetMaintenanceBlock[];
  readonly assigned: boolean;
}): VehicleAvailabilityNow {
  const docs = documentStatuses(input.vehicle, input.now, input.policy);
  if (docs.some((doc) => doc.status === "expired")) {
    return "doc_expired";
  }
  const at = input.now.getTime();
  const inMaintenance = input.maintenance.some(
    (block) =>
      (block.status === "active" || block.status === "scheduled") &&
      block.startsAt.getTime() <= at &&
      (block.endsAt === null || block.endsAt.getTime() > at),
  );
  if (inMaintenance) {
    return "maintenance";
  }
  if (docs.some((doc) => doc.status === "missing")) {
    return "documents_pending";
  }
  return input.assigned ? "in_service" : "unassigned";
}

export async function addVehicle(
  deps: FleetDeps,
  access: FleetAccess,
  input: AddVehicleInput,
  scopedKey: string,
) {
  assertCapability(access, "manage_vehicles");
  const allowed = new Set<string>(access.config.city.vehicleClasses);
  const outside = input.classes.filter((cls) => !allowed.has(cls));
  if (outside.length > 0) {
    throw new ContractError(
      "validation_failed",
      "every class must be one the city offers",
      { classes: outside, cityClasses: [...allowed] },
    );
  }
  const fleetVehicleId = deterministicId("fvh", scopedKey);
  const replay = await deps.db.fleetVehicle.findUnique({
    where: { id: fleetVehicleId },
  });
  if (replay !== null) {
    return vehicleView(deps, access, replay.vehicleId);
  }
  const plate = normalisePlate(input.plate);
  const registered = await deps.db.vehicle.findUnique({
    where: { plateNumber: plate },
  });
  if (registered !== null) {
    throw new ContractError(
      "conflict",
      "a vehicle with this plate is already registered with UBI; moving it into a fleet needs UBI ops",
      { reason: "vehicle_already_registered" },
    );
  }
  const now = deps.now();
  let vehicleId: string;
  try {
    vehicleId = await withOutbox(deps.db, async (tx) => {
      const vehicle = await tx.vehicle.create({
        data: {
          make: input.make,
          model: input.model,
          year: input.year,
          color: input.color,
          plateNumber: plate,
          type: input.type,
          capacity: input.capacity,
          isElectric: input.type === "ELECTRIC",
        },
      });
      await tx.fleetVehicle.create({
        data: {
          id: fleetVehicleId,
          fleetId: access.fleet.id,
          vehicleId: vehicle.id,
          classes: [...input.classes],
          capacity: input.capacity,
          status: "active",
          addedBy: access.actor.id,
        },
      });
      return {
        result: vehicle.id,
        audits: [
          {
            actor: access.actor,
            action: "fleet.vehicle.added",
            subjectType: "fleet_vehicle",
            subjectId: fleetVehicleId,
            after: {
              fleetId: access.fleet.id,
              vehicleId: vehicle.id,
              classes: [...input.classes],
              capacity: input.capacity,
            },
          },
        ],
        events: [
          {
            name: "fleet.vehicle.added",
            aggregateType: "vehicle",
            aggregateId: fleetVehicleId,
            fromVersion: null,
            toVersion: 1,
            actor: access.actor,
            cityId: access.cityId,
            occurredAt: now,
            payload: {
              fleetId: access.fleet.id,
              vehicleId: vehicle.id,
              classes: [...input.classes],
              capacity: input.capacity,
            },
          },
        ],
      };
    });
  } catch (error) {
    if (isUniqueViolation(error) || exclusionConstraintOf(error) !== null) {
      const again = await deps.db.fleetVehicle.findUnique({
        where: { id: fleetVehicleId },
      });
      if (again !== null) {
        return vehicleView(deps, access, again.vehicleId);
      }
      throw new ContractError(
        "conflict",
        "a vehicle with this plate is already registered with UBI",
        { reason: "vehicle_already_registered" },
      );
    }
    throw error;
  }
  return vehicleView(deps, access, vehicleId);
}

/** The fleet vehicle row, or not_found when it is not ACTIVE in this fleet. */
export async function fleetVehicleOf(
  db: FleetTx,
  fleetId: string,
  vehicleId: string,
): Promise<FleetVehicle & { vehicle: Vehicle }> {
  if (!isUuid(vehicleId)) {
    throw notFound("vehicle");
  }
  const row = await db.fleetVehicle.findFirst({
    where: { fleetId, vehicleId, status: "active" },
    include: { vehicle: true },
  });
  if (row === null) {
    throw notFound("vehicle");
  }
  return row;
}

export async function listVehicles(deps: FleetDeps, access: FleetAccess) {
  const rows = await deps.db.fleetVehicle.findMany({
    where: { fleetId: access.fleet.id, status: "active" },
    include: { vehicle: true },
    orderBy: { createdAt: "asc" },
  });
  const views = await vehicleViews(deps, access, rows);
  return { vehicles: views };
}

export async function vehicleView(
  deps: FleetDeps,
  access: FleetAccess,
  vehicleId: string,
) {
  const row = await fleetVehicleOf(deps.db, access.fleet.id, vehicleId);
  const [view] = await vehicleViews(deps, access, [row]);
  if (view === undefined) {
    throw notFound("vehicle");
  }
  return view;
}

const PLANNED_MAINTENANCE = ["planned_service", "inspection", "repair"];

async function loadFleetWeekAssignmentInputs(
  db: FleetTx,
  fleetId: string,
  zone: string,
  weekStart: string,
): Promise<FleetWeekMoneyAssignmentInput[]> {
  const weekEndExclusive = addDays(weekStart, 7);
  const week: Interval = {
    start: startOfLocalDay(weekStart, zone),
    end: startOfLocalDay(weekEndExclusive, zone),
  };
  const rows = await db.fleetAssignment.findMany({
    where: {
      fleetId,
      validFrom: { lte: localDateToDateColumn(weekEndExclusive) },
      OR: [
        { validTo: null },
        { validTo: { gte: localDateToDateColumn(addDays(weekStart, -1)) } },
      ],
    },
    orderBy: [{ validFrom: "asc" }, { id: "asc" }],
  });
  const vehicleIds = [...new Set(rows.map((row) => row.vehicleId))];
  const blocks =
    vehicleIds.length === 0
      ? []
      : await db.fleetMaintenanceBlock.findMany({
          where: {
            vehicleId: { in: vehicleIds },
            status: { in: ["scheduled", "active", "completed"] },
            startsAt: { lt: new Date(week.end) },
          },
        });
  const assignments: FleetWeekMoneyAssignmentInput[] = [];
  for (const row of rows) {
    const validFrom = dateColumnToLocalDate(row.validFrom);
    const validTo = validToOf(row.validTo);
    if (validTo !== null && validTo <= validFrom) {
      continue;
    }
    const activeFrom = startOfLocalDay(validFrom, row.zone);
    const activeTo =
      validTo === null ? null : startOfLocalDay(validTo, row.zone);
    const shift = mergeIntervals(
      shiftIntervals(shiftOf(row), row.zone, validFrom, validTo, week),
    );
    const validityTouchesWeek =
      activeFrom < week.end && (activeTo === null || activeTo > week.start);
    if (shift.length === 0 && !validityTouchesWeek) {
      continue;
    }
    const planned = mergeIntervals(
      blocks
        .filter(
          (block) =>
            block.vehicleId === row.vehicleId &&
            PLANNED_MAINTENANCE.includes(block.kind) &&
            block.endsAt !== null,
        )
        .map((block) => ({
          start: block.startsAt.getTime(),
          end: (block.endsAt as Date).getTime(),
        })),
    );
    const terms = termsOf(row);
    assignments.push({
      assignmentId: row.id,
      driverId: row.driverId,
      vehicleId: row.vehicleId,
      activeFrom: iso(activeFrom),
      activeTo: activeTo === null ? null : iso(activeTo),
      termsVersion: row.termsVersion,
      termsType: terms.type,
      shiftHours: hours2dp(totalMs(shift)),
      plannedMaintenanceHours: hours2dp(totalMs(intersectAll(shift, planned))),
    });
  }
  return assignments;
}

/**
 * Resolves the fleet's weekly money summary from payment-service
 * (CC-A02 / CC-C03, DEC-9 = A, Q7). Queries signed arrangements outside any SQL
 * transaction (pool-deadlock rule) before making the outbound HTTP call,
 * and returns `null` when payment-service is unconfigured or unreachable.
 */
export async function resolveFleetWeekMoney(
  deps: FleetDeps,
  access: FleetAccess,
  now: Date,
  vehicleIds?: readonly string[],
  requestedWeekStart?: string,
): Promise<FleetWeekMoneyResponse | null> {
  if (deps.payments === undefined) {
    return null;
  }
  const today = localDateOf(now.getTime(), access.fleet.zone);
  const weekday = isoWeekday(today);
  const weekStart = requestedWeekStart ?? addDays(today, -(weekday - 1));
  const assignments = await loadFleetWeekAssignmentInputs(
    deps.db,
    access.fleet.id,
    access.fleet.zone,
    weekStart,
  );
  return deps.payments.weekMoney({
    fleetId: access.fleet.id,
    cityId: access.cityId,
    weekStart,
    ...(vehicleIds === undefined ? {} : { vehicleIds: [...vehicleIds] }),
    assignments,
  });
}

/**
 * Weekly remittance statement and fleet wallet summary (CC-C03 / P1-09, DEC-9 = A).
 * All money figures come from payment-service; fleet-service hydrates driver
 * display names, vehicle plates, and signed-arrangement hours only.
 */
export async function fleetRemittanceStatement(
  deps: FleetDeps,
  access: FleetAccess,
  weekStartParam?: string,
): Promise<FleetRemittanceStatement> {
  const now = deps.now();
  const today = localDateOf(now.getTime(), access.fleet.zone);
  const currentMonday = addDays(today, -(isoWeekday(today) - 1));
  const weekStart = weekStartParam ?? currentMonday;
  if (
    !/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(weekStart) ||
    isoWeekday(weekStart) !== 1
  ) {
    throw new ContractError(
      "validation_failed",
      "weekStart must be a Monday (YYYY-MM-DD)",
      { weekStart },
    );
  }
  const weekEnd = addDays(weekStart, 6);
  const [assignmentInputs, fleetVehicles] = await Promise.all([
    loadFleetWeekAssignmentInputs(
      deps.db,
      access.fleet.id,
      access.fleet.zone,
      weekStart,
    ),
    deps.db.fleetVehicle.findMany({
      where: { fleetId: access.fleet.id },
      include: { vehicle: true },
    }),
  ]);
  const vehicleIds = fleetVehicles.map((fv) => fv.vehicleId);
  const plateByVehicle = new Map<string, string>(
    fleetVehicles.map((fv) => [fv.vehicleId, fv.vehicle.plateNumber]),
  );
  const weekMoney =
    deps.payments === undefined
      ? null
      : await deps.payments.weekMoney({
          fleetId: access.fleet.id,
          cityId: access.cityId,
          weekStart,
          vehicleIds,
          assignments: assignmentInputs,
        });
  if (weekMoney === null) {
    return {
      available: false,
      fleetId: access.fleet.id,
      cityId: access.cityId,
      zone: access.fleet.zone,
      weekStart,
      weekEnd,
      reason: MONEY_UNAVAILABLE.reason,
      source: MONEY_UNAVAILABLE.source,
    };
  }
  const inputByAssignment = new Map<string, FleetWeekMoneyAssignmentInput>(
    assignmentInputs.map((item) => [item.assignmentId, item]),
  );
  const allDriverIds = [
    ...new Set([
      ...assignmentInputs.map((item) => item.driverId),
      ...(weekMoney.statementItems ?? []).map((item) => item.driverId),
    ]),
  ];
  const names = await displayNames(deps.db, allDriverIds);
  const zeroMoney = { amountMinor: 0, currency: access.fleet.currency };
  const wallet = weekMoney.wallet ?? {
    walletId: null,
    balance: zeroMoney,
    asOf: weekMoney.asOf,
    cashOutAvailable: false as const,
    cashOutStatus:
      "Cash-out is not available yet. Settled remittance is credited to your UBI fleet wallet.",
  };

  const rawItems =
    weekMoney.statementItems ??
    assignmentInputs.map((slice) => {
      const summary = weekMoney.assignments[slice.assignmentId] ?? {
        weekGross: zeroMoney,
        ubiCommission: zeroMoney,
        fleetRemittance: zeroMoney,
        remittanceStatus: "Pending settlement",
        remittance: {
          due: zeroMoney,
          collected: zeroMoney,
          shortfall: zeroMoney,
          carried: zeroMoney,
          refunded: zeroMoney,
        },
      };
      return {
        assignmentId: slice.assignmentId,
        driverId: slice.driverId,
        vehicleId: slice.vehicleId,
        settled: summary.remittanceStatus === "Settled",
        settledAt: null,
        termsVersion: slice.termsVersion ?? 1,
        termsType: slice.termsType ?? "weekly_fixed",
        shiftHours: slice.shiftHours ?? 0,
        plannedMaintenanceHours: slice.plannedMaintenanceHours ?? 0,
        capApplied: false,
        weekGross: summary.weekGross,
        ubiCommission: summary.ubiCommission,
        fleetRemittance: summary.fleetRemittance,
        remittanceStatus: summary.remittanceStatus,
        remittance: summary.remittance,
        journalEntryId: null,
        journalReference: null,
        adjustments: [],
      };
    });

  const assignments: FleetRemittanceAssignmentRow[] = rawItems.map((item) => {
    const localSlice = inputByAssignment.get(item.assignmentId);
    return {
      assignmentId: item.assignmentId,
      driverId: item.driverId,
      driverDisplayName: nameOr(names, item.driverId),
      vehicleId: item.vehicleId,
      plate: plateByVehicle.get(item.vehicleId) ?? item.vehicleId,
      settled: item.settled,
      settledAt: item.settledAt,
      termsVersion: item.termsVersion ?? localSlice?.termsVersion ?? 1,
      termsType: item.termsType ?? localSlice?.termsType ?? "weekly_fixed",
      shiftHours: item.shiftHours ?? localSlice?.shiftHours ?? 0,
      plannedMaintenanceHours:
        item.plannedMaintenanceHours ??
        localSlice?.plannedMaintenanceHours ??
        0,
      capApplied: item.capApplied,
      weekGross: item.weekGross,
      ubiCommission: item.ubiCommission,
      fleetRemittance: item.fleetRemittance,
      remittanceStatus: item.remittanceStatus,
      remittance: item.remittance,
      journalEntryId: item.journalEntryId,
      journalReference: item.journalReference,
      adjustments: item.adjustments,
    };
  });

  return {
    available: true,
    fleetId: access.fleet.id,
    cityId: access.cityId,
    zone: access.fleet.zone,
    weekStart: weekMoney.weekStart,
    weekEnd: weekMoney.weekEnd,
    asOf: weekMoney.asOf,
    excludes: weekMoney.excludes,
    wallet,
    fleet: weekMoney.fleet,
    assignments,
  };
}

async function vehicleViews(
  deps: FleetDeps,
  access: FleetAccess,
  rows: readonly (FleetVehicle & { vehicle: Vehicle })[],
) {
  const now = deps.now();
  const today = localDateOf(now.getTime(), access.fleet.zone);
  const vehicleIds = rows.map((row) => row.vehicleId);
  const [arrangements, blocks, weekMoney] = await Promise.all([
    arrangementsOn(deps.db, { fleetId: access.fleet.id, vehicleIds }, today),
    deps.db.fleetMaintenanceBlock.findMany({
      where: {
        vehicleId: { in: vehicleIds },
        status: { in: ["scheduled", "active"] },
      },
    }),
    resolveFleetWeekMoney(deps, access, now, vehicleIds),
  ]);
  const names = await displayNames(
    deps.db,
    arrangements.map((row) => row.driverId),
  );
  return rows.map((row) => {
    const mine = arrangements.filter((a) => a.vehicleId === row.vehicleId);
    const money =
      weekMoney === null
        ? MONEY_UNAVAILABLE
        : summaryToFleetMoney(
            weekMoney.vehicles[row.vehicleId],
            weekMoney,
            MONEY_UNAVAILABLE,
          );
    return {
      vehicleId: row.vehicleId,
      plate: row.vehicle.plateNumber,
      make: row.vehicle.make,
      model: row.vehicle.model,
      year: row.vehicle.year,
      color: row.vehicle.color,
      classes: [...row.classes],
      capacity: row.capacity,
      statusNow: availabilityNow({
        vehicle: row.vehicle,
        now,
        policy: access.config.policy,
        maintenance: blocks.filter(
          (block) => block.vehicleId === row.vehicleId,
        ),
        assigned: mine.length > 0,
      }),
      drivers: mine.map((a) => ({
        driverId: a.driverId,
        displayName: nameOr(names, a.driverId),
        shift: shiftOf(a),
        termsVersion: a.termsVersion,
      })),
      documents: documentStatuses(row.vehicle, now, access.config.policy),
      money,
      addedAt: iso(row.createdAt.getTime()),
    };
  });
}
