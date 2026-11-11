/**
 * Fleet staff invitations, role updates, removal, and ownership transfer
 * (CC-C02 / P1-05).
 *
 * State machine (`staffInvitation`):
 *   pending → accepted | declined | revoked | expired
 *
 * Rules:
 *  - Only a fleet `owner` (`manage_staff`) may send or revoke an invitation,
 *    change a staff member's role, or remove a staff member.
 *  - Invitations are sent by E.164 phone + role (`owner` | `manager` |
 *    `read_only`) or `kind: "ownership_transfer"` (which forces role `owner`
 *    and demotes the inviting owner to `manager` atomically when the new owner
 *    accepts).
 *  - The last-owner rule is enforced on every role change and removal.
 *  - Response views carry `inviteeMasked` (never raw phone numbers) so the
 *    fleet privacy walk (`FLEET_FORBIDDEN_FIELD_PATTERNS`) passes cleanly.
 */
import {
  ContractError,
  canFleetTransition,
  type CreateFleetInvitationInput,
  type FleetInvitationKind,
  type FleetInvitationList,
  type FleetInvitationStatus,
  type FleetInvitationView,
  type FleetStaffRole,
  type PatchFleetStaffRoleInput,
} from "@ubi/contracts";

import { requireFleetEnabled } from "./config";
import { FleetError, illegalTransition, notFound } from "./errors";
import { listStaff } from "./fleets";
import { withOutbox, type OutboxInput } from "./outbox";
import { assertCapability, type FleetAccess } from "./roles";
import { displayNames } from "./views";
import { generateId, isUuid } from "../lib/ids";
import { HOUR_MS, iso } from "../lib/time";

import type { FleetDeps } from "./context";
import type { Actor } from "./types";
import type { FleetInvitation } from "@prisma/client/index";

export function maskInviteePhone(phone: string): string {
  const cleaned = phone.trim();
  if (cleaned.length <= 6) {
    return "•••";
  }
  const prefix = cleaned.slice(0, 4);
  const suffix = cleaned.slice(-4);
  return `${prefix} ••• ••• ${suffix}`;
}

function invitationView(
  row: FleetInvitation,
  fleetName: string,
  inviteeDisplayName: string | null,
): FleetInvitationView {
  return {
    invitationId: row.id,
    fleetId: row.fleetId,
    fleetName,
    kind: row.kind as FleetInvitationKind,
    role: row.role as FleetStaffRole,
    inviteeMasked: row.inviteeMasked || maskInviteePhone(row.inviteePhone),
    inviteeUserId: row.inviteeUserId,
    inviteeDisplayName,
    invitedByUserId: row.invitedBy,
    status: row.status as FleetInvitationStatus,
    expiresAt: iso(row.expiresAt.getTime()),
    respondedAt:
      row.status !== "revoked" && row.respondedAt !== null
        ? iso(row.respondedAt.getTime())
        : null,
    revokedAt:
      row.status === "revoked" && row.respondedAt !== null
        ? iso(row.respondedAt.getTime())
        : null,
    createdAt: iso(row.createdAt.getTime()),
  };
}

export async function createInvitation(
  deps: FleetDeps,
  access: FleetAccess,
  input: CreateFleetInvitationInput,
): Promise<FleetInvitationView> {
  assertCapability(access, "manage_staff");
  const kind: FleetInvitationKind = input.kind ?? "staff_invite";
  const role: FleetStaffRole =
    kind === "ownership_transfer" ? "owner" : input.role;
  const phone = input.phone.trim();

  const existingUser = await deps.db.user.findUnique({
    where: { phone },
    select: { id: true, firstName: true, lastName: true },
  });
  if (existingUser?.id === access.actor.id && kind === "ownership_transfer") {
    throw new ContractError(
      "validation_failed",
      "Cannot transfer ownership to yourself",
    );
  }
  if (existingUser !== null) {
    const existingStaff = await deps.db.fleetStaff.findUnique({
      where: {
        fleetId_userId: { fleetId: access.fleet.id, userId: existingUser.id },
      },
    });
    if (
      existingStaff !== null &&
      existingStaff.status === "active" &&
      existingStaff.role === role &&
      kind === "staff_invite"
    ) {
      throw new ContractError(
        "conflict",
        "This user is already an active staff member with that role",
        { userId: existingUser.id, role },
      );
    }
  }

  const now = deps.now();
  const ttlHours = access.config.policy.proposalTtlHours;
  const expiresAt = new Date(now.getTime() + ttlHours * HOUR_MS);
  const invitationId = generateId("fin");
  const fleetId = access.fleet.id;

  const inviteeDisplayName =
    existingUser !== null
      ? [existingUser.firstName, existingUser.lastName]
          .filter(Boolean)
          .join(" ")
          .trim() || null
      : null;

  return withOutbox(deps.db, async (tx) => {
    // Revoke any earlier pending invitation for the same phone in this fleet.
    await tx.fleetInvitation.updateMany({
      where: {
        fleetId,
        inviteePhone: phone,
        status: "pending",
      },
      data: {
        status: "revoked",
        respondedAt: now,
        version: { increment: 1 },
      },
    });

    const created = await tx.fleetInvitation.create({
      data: {
        id: invitationId,
        fleetId,
        inviteePhone: phone,
        inviteeMasked: maskInviteePhone(phone),
        inviteeUserId: existingUser?.id ?? null,
        role,
        kind,
        invitedBy: access.actor.id,
        status: "pending",
        expiresAt,
        idempotencyKey: generateId("fik"),
      },
    });

    return {
      result: invitationView(created, access.fleet.name, inviteeDisplayName),
      audits: [
        {
          actor: access.actor,
          action: "fleet.invitation.sent",
          subjectType: "fleet",
          subjectId: fleetId,
          after: {
            invitationId,
            kind,
            role,
            inviteeUserId: existingUser?.id ?? null,
            expiresAt: iso(expiresAt.getTime()),
          },
        },
      ],
      events: [
        {
          name: "fleet.invitation.sent",
          aggregateType: "fleet",
          aggregateId: fleetId,
          fromVersion: null,
          toVersion: 1,
          idempotencyKey: `fleet.invitation.sent:${invitationId}`,
          actor: access.actor,
          cityId: access.cityId,
          occurredAt: now,
          payload: {
            invitationId,
            fleetId,
            kind,
            role,
            invitedByUserId: access.actor.id,
            inviteeUserId: existingUser?.id ?? null,
            expiresAt: iso(expiresAt.getTime()),
          },
        },
      ],
    };
  });
}

export async function listFleetInvitations(
  deps: FleetDeps,
  access: FleetAccess,
): Promise<FleetInvitationList> {
  const rows = await deps.db.fleetInvitation.findMany({
    where: { fleetId: access.fleet.id },
    orderBy: { createdAt: "desc" },
  });
  const userIds = rows
    .map((r) => r.inviteeUserId)
    .filter((id): id is string => id !== null);
  const names = await displayNames(deps.db, userIds);
  return {
    invitations: rows.map((row) =>
      invitationView(
        row,
        access.fleet.name,
        row.inviteeUserId ? (names.get(row.inviteeUserId) ?? null) : null,
      ),
    ),
  };
}

export async function revokeInvitation(
  deps: FleetDeps,
  access: FleetAccess,
  invitationId: string,
): Promise<FleetInvitationView> {
  assertCapability(access, "manage_staff");
  const row = await deps.db.fleetInvitation.findFirst({
    where: { id: invitationId, fleetId: access.fleet.id },
  });
  if (row === null) {
    throw notFound("invitation");
  }
  if (!canFleetTransition("staffInvitation", row.status, "revoked")) {
    throw illegalTransition("staffInvitation", row.status, "revoked");
  }
  const now = deps.now();
  return withOutbox(deps.db, async (tx) => {
    const updated = await tx.fleetInvitation.update({
      where: { id: row.id },
      data: {
        status: "revoked",
        respondedAt: now,
        version: { increment: 1 },
      },
    });
    const names = row.inviteeUserId
      ? await displayNames(tx, [row.inviteeUserId])
      : new Map<string, string>();
    return {
      result: invitationView(
        updated,
        access.fleet.name,
        row.inviteeUserId ? (names.get(row.inviteeUserId) ?? null) : null,
      ),
      audits: [
        {
          actor: access.actor,
          action: "fleet.invitation.revoked",
          subjectType: "fleet",
          subjectId: access.fleet.id,
          before: { status: row.status },
          after: { status: "revoked", invitationId: row.id },
        },
      ],
      events: [
        {
          name: "fleet.invitation.revoked",
          aggregateType: "fleet",
          aggregateId: access.fleet.id,
          fromVersion: row.version,
          toVersion: updated.version,
          idempotencyKey: `fleet.invitation.revoked:${row.id}:v${updated.version}`,
          actor: access.actor,
          cityId: access.cityId,
          occurredAt: now,
          payload: {
            invitationId: row.id,
            fleetId: access.fleet.id,
            revokedByUserId: access.actor.id,
          },
        },
      ],
    };
  });
}

async function callerPhone(
  deps: FleetDeps,
  userId: string,
): Promise<string | null> {
  if (!isUuid(userId)) {
    return null;
  }
  const user = await deps.db.user.findUnique({
    where: { id: userId },
    select: { phone: true },
  });
  return user?.phone ?? null;
}

export async function listMyInvitations(
  deps: FleetDeps,
  actor: Actor,
  cityId: string,
): Promise<FleetInvitationList> {
  await requireFleetEnabled(deps.config, cityId);
  const phone = await callerPhone(deps, actor.id);
  const rows = await deps.db.fleetInvitation.findMany({
    where: {
      OR: [
        { inviteeUserId: actor.id },
        ...(phone !== null ? [{ inviteePhone: phone }] : []),
      ],
      fleet: { cityId },
    },
    include: { fleet: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });
  const names = await displayNames(deps.db, [actor.id]);
  return {
    invitations: rows.map((row) =>
      invitationView(row, row.fleet.name, names.get(actor.id) ?? null),
    ),
  };
}

export async function respondToInvitation(
  deps: FleetDeps,
  actor: Actor,
  cityId: string,
  invitationId: string,
  decision: "accepted" | "declined",
): Promise<FleetInvitationView> {
  await requireFleetEnabled(deps.config, cityId);
  const row = await deps.db.fleetInvitation.findUnique({
    where: { id: invitationId },
    include: { fleet: true },
  });
  if (row === null || row.fleet.cityId !== cityId) {
    throw notFound("invitation");
  }
  const phone = await callerPhone(deps, actor.id);
  const matchesUser =
    row.inviteeUserId === actor.id ||
    (phone !== null && row.inviteePhone === phone);
  if (!matchesUser) {
    throw notFound("invitation");
  }

  const now = deps.now();
  if (row.status === "pending" && row.expiresAt.getTime() <= now.getTime()) {
    await deps.db.fleetInvitation.update({
      where: { id: row.id },
      data: { status: "expired", version: { increment: 1 } },
    });
    throw new FleetError("invitation_expired", "This invitation has expired.", {
      invitationId: row.id,
      expiresAt: iso(row.expiresAt.getTime()),
    });
  }

  if (!canFleetTransition("staffInvitation", row.status, decision)) {
    throw illegalTransition("staffInvitation", row.status, decision);
  }

  return withOutbox(deps.db, async (tx) => {
    const updated = await tx.fleetInvitation.update({
      where: { id: row.id },
      data: {
        status: decision,
        inviteeUserId: actor.id,
        respondedAt: now,
        version: { increment: 1 },
      },
    });

    const staffChanges: {
      userId: string;
      from: FleetStaffRole | "removed" | null;
      to: FleetStaffRole | "removed";
    }[] = [];

    if (decision === "accepted") {
      const targetRole = (
        row.kind === "ownership_transfer" ? "owner" : row.role
      ) as FleetStaffRole;
      const existingStaff = await tx.fleetStaff.findUnique({
        where: {
          fleetId_userId: { fleetId: row.fleetId, userId: actor.id },
        },
      });
      if (existingStaff === null) {
        await tx.fleetStaff.create({
          data: {
            id: generateId("fst"),
            fleetId: row.fleetId,
            userId: actor.id,
            role: targetRole,
            status: "active",
            addedBy: row.invitedBy,
          },
        });
        staffChanges.push({ userId: actor.id, from: null, to: targetRole });
      } else {
        const previousRole =
          existingStaff.status === "active"
            ? (existingStaff.role as FleetStaffRole)
            : "removed";
        await tx.fleetStaff.update({
          where: { id: existingStaff.id },
          data: {
            role: targetRole,
            status: "active",
            removedAt: null,
            version: { increment: 1 },
          },
        });
        staffChanges.push({
          userId: actor.id,
          from: previousRole,
          to: targetRole,
        });
      }

      if (row.kind === "ownership_transfer" && row.invitedBy !== actor.id) {
        const formerOwner = await tx.fleetStaff.findUnique({
          where: {
            fleetId_userId: {
              fleetId: row.fleetId,
              userId: row.invitedBy,
            },
          },
        });
        if (
          formerOwner !== null &&
          formerOwner.status === "active" &&
          formerOwner.role === "owner"
        ) {
          await tx.fleetStaff.update({
            where: { id: formerOwner.id },
            data: {
              role: "manager",
              version: { increment: 1 },
            },
          });
          staffChanges.push({
            userId: formerOwner.userId,
            from: "owner",
            to: "manager",
          });
        }
      }
    }

    const names = await displayNames(tx, [actor.id]);
    const fleetVersion = row.fleet.version + 1;
    await tx.fleet.update({
      where: { id: row.fleetId },
      data: { version: { increment: 1 } },
    });

    const events: OutboxInput[] = [
      {
        name: "fleet.invitation.responded",
        aggregateType: "fleet",
        aggregateId: row.fleetId,
        fromVersion: row.version,
        toVersion: updated.version,
        idempotencyKey: `fleet.invitation.responded:${row.id}:v${updated.version}`,
        actor,
        cityId,
        occurredAt: now,
        payload: {
          invitationId: row.id,
          fleetId: row.fleetId,
          kind: row.kind as FleetInvitationKind,
          role: row.role as FleetStaffRole,
          userId: actor.id,
          outcome: decision,
        },
      },
    ];
    if (staffChanges.length > 0) {
      events.push({
        name: "fleet.staff.changed",
        aggregateType: "fleet",
        aggregateId: row.fleetId,
        fromVersion: row.fleet.version,
        toVersion: fleetVersion,
        actor,
        cityId,
        occurredAt: now,
        payload: {
          fleetId: row.fleetId,
          changes: staffChanges,
        },
      });
    }

    return {
      result: invitationView(
        updated,
        row.fleet.name,
        names.get(actor.id) ?? null,
      ),
      audits: [
        {
          actor,
          action: `fleet.invitation.${decision}`,
          subjectType: "fleet",
          subjectId: row.fleetId,
          before: { status: row.status },
          after: {
            status: decision,
            invitationId: row.id,
            kind: row.kind,
            role: row.role,
          },
        },
      ],
      events,
    };
  });
}

export async function updateStaffMemberRole(
  deps: FleetDeps,
  access: FleetAccess,
  staffId: string,
  input: PatchFleetStaffRoleInput,
) {
  assertCapability(access, "manage_staff");
  const member = await deps.db.fleetStaff.findFirst({
    where: {
      id: staffId,
      fleetId: access.fleet.id,
      status: "active",
    },
  });
  if (member === null) {
    throw notFound("staff_member");
  }
  if (member.role === input.role) {
    return listStaff(deps, access);
  }
  if (member.role === "owner" && input.role !== "owner") {
    const ownerCount = await deps.db.fleetStaff.count({
      where: {
        fleetId: access.fleet.id,
        status: "active",
        role: "owner",
      },
    });
    if (ownerCount <= 1) {
      throw new ContractError(
        "validation_failed",
        "a fleet must keep at least one owner",
        { reason: "owner_required" },
      );
    }
  }
  const now = deps.now();
  await withOutbox(deps.db, async (tx) => {
    await tx.fleetStaff.update({
      where: { id: member.id },
      data: {
        role: input.role,
        version: { increment: 1 },
      },
    });
    const updatedFleet = await tx.fleet.update({
      where: { id: access.fleet.id },
      data: { version: { increment: 1 } },
    });
    return {
      result: null,
      audits: [
        {
          actor: access.actor,
          action: "fleet.staff.changed",
          subjectType: "fleet_staff",
          subjectId: `${access.fleet.id}:${member.userId}`,
          before: member.role,
          after: input.role,
        },
      ],
      events: [
        {
          name: "fleet.staff.changed",
          aggregateType: "fleet",
          aggregateId: access.fleet.id,
          fromVersion: access.fleet.version,
          toVersion: updatedFleet.version,
          actor: access.actor,
          cityId: access.cityId,
          occurredAt: now,
          payload: {
            fleetId: access.fleet.id,
            changes: [
              {
                userId: member.userId,
                from: member.role as FleetStaffRole,
                to: input.role,
              },
            ],
          },
        },
      ],
    };
  });
  return listStaff(deps, access);
}

export async function removeStaffMember(
  deps: FleetDeps,
  access: FleetAccess,
  staffId: string,
) {
  assertCapability(access, "manage_staff");
  const member = await deps.db.fleetStaff.findFirst({
    where: {
      id: staffId,
      fleetId: access.fleet.id,
      status: "active",
    },
  });
  if (member === null) {
    throw notFound("staff_member");
  }
  if (member.role === "owner") {
    const ownerCount = await deps.db.fleetStaff.count({
      where: {
        fleetId: access.fleet.id,
        status: "active",
        role: "owner",
      },
    });
    if (ownerCount <= 1) {
      throw new ContractError(
        "validation_failed",
        "a fleet must keep at least one owner",
        { reason: "owner_required" },
      );
    }
  }
  const now = deps.now();
  await withOutbox(deps.db, async (tx) => {
    await tx.fleetStaff.update({
      where: { id: member.id },
      data: {
        status: "removed",
        removedAt: now,
        version: { increment: 1 },
      },
    });
    const updatedFleet = await tx.fleet.update({
      where: { id: access.fleet.id },
      data: { version: { increment: 1 } },
    });
    return {
      result: null,
      audits: [
        {
          actor: access.actor,
          action: "fleet.staff.changed",
          subjectType: "fleet_staff",
          subjectId: `${access.fleet.id}:${member.userId}`,
          before: member.role,
          after: "removed",
        },
      ],
      events: [
        {
          name: "fleet.staff.changed",
          aggregateType: "fleet",
          aggregateId: access.fleet.id,
          fromVersion: access.fleet.version,
          toVersion: updatedFleet.version,
          actor: access.actor,
          cityId: access.cityId,
          occurredAt: now,
          payload: {
            fleetId: access.fleet.id,
            changes: [
              {
                userId: member.userId,
                from: member.role as FleetStaffRole,
                to: "removed",
              },
            ],
          },
        },
      ],
    };
  });
  return listStaff(deps, access);
}

export async function expireInvitations(deps: FleetDeps): Promise<number> {
  const now = deps.now();
  const lapsed = await deps.db.fleetInvitation.updateMany({
    where: {
      status: "pending",
      expiresAt: { lte: now },
    },
    data: {
      status: "expired",
      version: { increment: 1 },
    },
  });
  return lapsed.count;
}
