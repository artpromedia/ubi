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
import { displayNames, documentStatuses, nameOr, shiftOf } from "./views";
import { deterministicId, isUuid } from "../lib/ids";
import { iso, localDateOf, localDateToDateColumn } from "../lib/time";

import type { FleetDeps } from "./context";
import type { FleetTx } from "./types";
import type { FleetPolicy } from "../contract";
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

async function vehicleViews(
  deps: FleetDeps,
  access: FleetAccess,
  rows: readonly (FleetVehicle & { vehicle: Vehicle })[],
) {
  const now = deps.now();
  const today = localDateOf(now.getTime(), access.fleet.zone);
  const vehicleIds = rows.map((row) => row.vehicleId);
  const arrangements = await arrangementsOn(
    deps.db,
    { fleetId: access.fleet.id, vehicleIds },
    today,
  );
  const blocks = await deps.db.fleetMaintenanceBlock.findMany({
    where: {
      vehicleId: { in: vehicleIds },
      status: { in: ["scheduled", "active"] },
    },
  });
  const names = await displayNames(
    deps.db,
    arrangements.map((row) => row.driverId),
  );
  return rows.map((row) => {
    const mine = arrangements.filter((a) => a.vehicleId === row.vehicleId);
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
      money: MONEY_UNAVAILABLE,
      addedAt: iso(row.createdAt.getTime()),
    };
  });
}
