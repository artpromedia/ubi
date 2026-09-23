/**
 * Who may do what INSIDE a fleet (handoff B9, decisions correction 5).
 *
 * The gateway scope only lets a session ask; this is the authority. A caller
 * who is not ACTIVE staff of the fleet is answered `not_found` — the fleet's
 * existence is not disclosed — and a member whose role lacks the capability
 * is answered `forbidden` naming the roles that have it, so the portal can
 * hide the control ("Your role can view the calendar but can't create
 * maintenance. Ask a fleet owner or manager."). A fleet is only ever served
 * in its own city, with the `fleet` flag on there.
 */
import { ContractError } from "@ubi/contracts";

import {
  FLEET_CAPABILITIES,
  type FleetCapability,
  type FleetStaffRole,
} from "../contract";
import { requireFleetEnabled, type FleetCityConfig } from "./config";
import { notFound } from "./errors";

import type { FleetDeps } from "./context";
import type { Actor } from "./types";
import type { Fleet } from "@prisma/client/index";

export interface FleetAccess {
  readonly fleet: Fleet;
  readonly role: FleetStaffRole;
  readonly config: FleetCityConfig;
  readonly actor: Actor;
  readonly cityId: string;
}

export function roleCan(
  role: FleetStaffRole,
  capability: FleetCapability,
): boolean {
  return (FLEET_CAPABILITIES[capability] as readonly string[]).includes(role);
}

export function assertCapability(
  access: FleetAccess,
  capability: FleetCapability,
): void {
  if (!roleCan(access.role, capability)) {
    throw new ContractError(
      "forbidden",
      "Your fleet role can't do this. Ask a fleet owner.",
      {
        capability,
        role: access.role,
        allowedRoles: [...FLEET_CAPABILITIES[capability]],
      },
    );
  }
}

export async function fleetAccess(
  deps: FleetDeps,
  actor: Actor,
  cityId: string,
  fleetId: string,
  capability: FleetCapability,
): Promise<FleetAccess> {
  const config = await requireFleetEnabled(deps.config, cityId);
  const fleet = await deps.db.fleet.findUnique({ where: { id: fleetId } });
  if (fleet === null || fleet.cityId !== cityId) {
    throw notFound("fleet");
  }
  const staff = await deps.db.fleetStaff.findUnique({
    where: { fleetId_userId: { fleetId, userId: actor.id } },
  });
  if (staff === null || staff.status !== "active") {
    throw notFound("fleet");
  }
  const access: FleetAccess = {
    fleet,
    role: staff.role as FleetStaffRole,
    config,
    actor,
    cityId,
  };
  assertCapability(access, capability);
  if (fleet.status !== "active" && capability !== "view_calendar") {
    throw new ContractError("forbidden", "this fleet is suspended", {
      reason: "fleet_suspended",
    });
  }
  return access;
}
