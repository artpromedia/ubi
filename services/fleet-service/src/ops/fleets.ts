/**
 * Fleets and their staff.
 *
 * A fleet is created in the caller's VERIFIED city (never a city named in the
 * body), with that city's currency and zone, and the creator as its first
 * owner. Staff roles are owner / manager / read_only; only an owner manages
 * staff, and a fleet always keeps at least one owner. A removed member keeps
 * their row (status `removed`) so the audit trail still resolves.
 */
import { ContractError } from "@ubi/contracts";

import { requireFleetEnabled } from "./config";
import { withOutbox } from "./outbox";
import { assertCapability, type FleetAccess } from "./roles";
import { displayNames, fleetView } from "./views";
import { deterministicId, generateId, isUuid } from "../lib/ids";
import { iso } from "../lib/time";

import type { Actor } from "./types";
import type { FleetStaffRole } from "../contract";
import type { FleetDeps } from "./context";

export async function createFleet(
  deps: FleetDeps,
  actor: Actor,
  cityId: string,
  input: { readonly name: string },
  scopedKey: string,
): Promise<ReturnType<typeof fleetView>> {
  const config = await requireFleetEnabled(deps.config, cityId);
  const fleetId = deterministicId("flt", scopedKey);
  const existing = await deps.db.fleet.findUnique({ where: { id: fleetId } });
  if (existing !== null) {
    return fleetView(existing, "owner");
  }
  const now = deps.now();
  return withOutbox(deps.db, async (tx) => {
    const fleet = await tx.fleet.create({
      data: {
        id: fleetId,
        name: input.name,
        cityId,
        currency: config.city.currency,
        zone: config.city.timezone,
        status: "active",
        createdBy: actor.id,
      },
    });
    const staffId = generateId("fst");
    await tx.fleetStaff.create({
      data: {
        id: staffId,
        fleetId,
        userId: actor.id,
        role: "owner",
        status: "active",
        addedBy: actor.id,
      },
    });
    return {
      result: fleetView(fleet, "owner"),
      audits: [
        {
          actor,
          action: "fleet.created",
          subjectType: "fleet",
          subjectId: fleetId,
          after: {
            cityId,
            currency: fleet.currency,
            zone: fleet.zone,
            ownerId: actor.id,
          },
        },
      ],
      events: [
        {
          name: "fleet.created",
          aggregateType: "fleet",
          aggregateId: fleetId,
          fromVersion: null,
          toVersion: 1,
          actor,
          cityId,
          occurredAt: now,
          payload: { fleetId, cityId, ownerId: actor.id },
        },
      ],
    };
  });
}

export async function listMyFleets(
  deps: FleetDeps,
  actor: Actor,
  cityId: string,
): Promise<{ fleets: ReturnType<typeof fleetView>[] }> {
  await requireFleetEnabled(deps.config, cityId);
  const memberships = await deps.db.fleetStaff.findMany({
    where: { userId: actor.id, status: "active" },
    include: { fleet: true },
    orderBy: { createdAt: "asc" },
  });
  return {
    fleets: memberships
      .filter((membership) => membership.fleet.cityId === cityId)
      .map((membership) =>
        fleetView(membership.fleet, membership.role as FleetStaffRole),
      ),
  };
}

export async function listStaff(deps: FleetDeps, access: FleetAccess) {
  const staff = await deps.db.fleetStaff.findMany({
    where: { fleetId: access.fleet.id, status: "active" },
    orderBy: { createdAt: "asc" },
  });
  const names = await displayNames(
    deps.db,
    staff.map((member) => member.userId),
  );
  return {
    fleetId: access.fleet.id,
    staff: staff.map((member) => ({
      staffId: member.id,
      userId: member.userId,
      displayName: names.get(member.userId) ?? null,
      role: member.role as FleetStaffRole,
      addedAt: iso(member.createdAt.getTime()),
    })),
  };
}

/**
 * Replaces the fleet's active staff with `staff` (owner only). Members not
 * listed are removed; at least one owner must remain; every listed user must
 * be a real UBI user.
 */
export async function putStaff(
  deps: FleetDeps,
  access: FleetAccess,
  input: {
    readonly staff: readonly { userId: string; role: FleetStaffRole }[];
  },
) {
  assertCapability(access, "manage_staff");
  const wanted = new Map<string, FleetStaffRole>();
  for (const entry of input.staff) {
    if (wanted.has(entry.userId)) {
      throw new ContractError("validation_failed", "a user is listed twice", {
        userId: entry.userId,
      });
    }
    wanted.set(entry.userId, entry.role);
  }
  if (![...wanted.values()].includes("owner")) {
    throw new ContractError(
      "validation_failed",
      "a fleet must keep at least one owner",
      { reason: "owner_required" },
    );
  }
  const ids = [...wanted.keys()];
  const valid = ids.filter((id) => isUuid(id));
  const users = await deps.db.user.findMany({
    where: { id: { in: valid } },
    select: { id: true },
  });
  const known = new Set(users.map((user) => user.id));
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new ContractError(
      "validation_failed",
      "every staff member must be a UBI user",
      {
        unknownUserIds: unknown,
      },
    );
  }
  const now = deps.now();
  const fleetId = access.fleet.id;
  await withOutbox(deps.db, async (tx) => {
    const current = await tx.fleetStaff.findMany({ where: { fleetId } });
    const byUser = new Map(current.map((row) => [row.userId, row]));
    const changes: { userId: string; from: string | null; to: string }[] = [];
    for (const [userId, role] of wanted) {
      const row = byUser.get(userId);
      if (row === undefined) {
        await tx.fleetStaff.create({
          data: {
            id: generateId("fst"),
            fleetId,
            userId,
            role,
            status: "active",
            addedBy: access.actor.id,
          },
        });
        changes.push({ userId, from: null, to: role });
      } else if (row.status !== "active" || row.role !== role) {
        await tx.fleetStaff.update({
          where: { id: row.id },
          data: {
            role,
            status: "active",
            removedAt: null,
            version: { increment: 1 },
          },
        });
        changes.push({
          userId,
          from: row.status === "active" ? row.role : "removed",
          to: role,
        });
      }
    }
    for (const row of current) {
      if (row.status === "active" && !wanted.has(row.userId)) {
        await tx.fleetStaff.update({
          where: { id: row.id },
          data: {
            status: "removed",
            removedAt: now,
            version: { increment: 1 },
          },
        });
        changes.push({ userId: row.userId, from: row.role, to: "removed" });
      }
    }
    const version = access.fleet.version + 1;
    await tx.fleet.update({
      where: { id: fleetId },
      data: { version: { increment: 1 } },
    });
    return {
      result: null,
      audits: changes.map((change) => ({
        actor: access.actor,
        action: "fleet.staff.changed",
        subjectType: "fleet_staff",
        subjectId: `${fleetId}:${change.userId}`,
        before: change.from,
        after: change.to,
      })),
      events:
        changes.length === 0
          ? []
          : [
              {
                name: "fleet.staff.changed" as const,
                aggregateType: "fleet",
                aggregateId: fleetId,
                fromVersion: access.fleet.version,
                toVersion: version,
                actor: access.actor,
                cityId: access.cityId,
                occurredAt: now,
                payload: {
                  fleetId,
                  changes: changes.map((change) => ({
                    userId: change.userId,
                    from: change.from,
                    to: change.to,
                  })),
                },
              },
            ],
    };
  });
  return listStaff(deps, access);
}
