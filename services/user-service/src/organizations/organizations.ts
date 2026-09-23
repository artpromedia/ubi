/**
 * Organizations for business travel (A06 part C).
 *
 * An organization books trips for its people from PREFUNDED budgets that
 * payment-service keeps on the canonical ledger (src/business there). This
 * module owns everything that is not money: the organization and its travel
 * policy, cost centres, members and their roles, and invitations.
 *
 * The rules, all enforced here rather than trusted from a caller:
 *  - authority is derived from the caller's ACTIVE membership, read inside
 *    the same transaction as the change, from the gateway-signed identity
 *    only (routes/organizations.ts). Owners manage everything; admins manage
 *    bookers and travellers, cost centres, policy and billing; bookers and
 *    travellers manage nothing (they may leave). An organization always
 *    keeps at least one active owner — membership changes serialize on the
 *    organization row lock so two demotions cannot both pass that check;
 *  - joining is CONSENTED: an invitation is bound to one existing user and
 *    only that user can accept or decline it. Nobody becomes a traveller —
 *    and so visible to the organization's business-booking view — because an
 *    admin typed their number;
 *  - privacy: a member view carries a display name and role, never a phone,
 *    email or anything from the member's personal trips (that data is not
 *    even read here);
 *  - the travel policy is deny-by-default (zero cap, nothing allowed) and
 *    versioned: an edit names the version it was made against, so two admins
 *    cannot silently overwrite each other;
 *  - every change writes its audit row and outbox event in the same
 *    transaction, and every mutating request is idempotent on its
 *    Idempotency-Key: a replay answers the current state, a replay carrying
 *    a different body is `idempotency_key_reuse` (409);
 *  - `business_travel` (per city, deny-by-default) gates creating an
 *    organization and inviting members. Switching it off never locks anyone
 *    in: members can still be removed, invitations answered, policy tightened.
 */
import { createHash } from "node:crypto";

import { ContractError } from "@ubi/contracts";

import { assertBusinessTravelEnabled, loadOrgCity } from "./city";
import {
  ADMIN_MANAGEABLE_ROLES,
  isAdminRole,
  isOrgRole,
  ORG_AUDIT_SUBJECT,
  ORG_BOOKER_ROLES,
  ORG_INVITATION_TTL_DAYS,
  type OrgActor,
  type OrganizationDeps,
  type OrgEventName,
  type OrgRole,
} from "./model";
import { writeOrgEvent } from "./outbox";
import { writeAudit, type Tx } from "../identity/audit";
import { actorTypeFor } from "../identity/common";
import { deterministicId } from "../identity/ids";
import {
  eventIdempotencyKey,
  findOutboxByIdempotencyKey,
} from "../identity/outbox";

import type {
  CreateCostCentreInput,
  CreateOrganizationInput,
  InviteMemberInput,
  UpdateBillingInput,
  UpdateMemberInput,
  UpdatePolicyInput,
} from "./schemas";
import type {
  Organization,
  OrganizationCostCentre,
  OrganizationInvitation,
  OrganizationMember,
  Prisma,
} from "@prisma/client";

// ── Views (mirrors the contract's view schemas) ───────────────────────────

export interface OrganizationView {
  readonly id: string;
  readonly name: string;
  readonly cityId: string;
  readonly currency: string;
  readonly status: string;
  readonly policy: {
    readonly tripCap: {
      readonly amountMinor: number;
      readonly currency: string;
    };
    readonly allowedServices: readonly string[];
    readonly allowedClasses: readonly string[];
    readonly version: number;
  };
  readonly billing: {
    readonly legalName: string | null;
    readonly taxId: string | null;
  } | null;
  readonly myRole: OrgRole;
  readonly version: number;
  readonly createdAt: string;
}

export interface MemberView {
  readonly memberId: string;
  readonly userId: string;
  readonly displayName: string;
  readonly role: OrgRole;
  readonly status: string;
  readonly costCentreId: string | null;
  readonly joinedAt: string;
}

export interface InvitationView {
  readonly invitationId: string;
  readonly organizationId: string;
  readonly organizationName: string;
  readonly inviteeUserId: string;
  readonly role: OrgRole;
  readonly costCentreId: string | null;
  readonly status: string;
  readonly expiresAt: string;
  readonly createdAt: string;
}

export interface CostCentreView {
  readonly costCentreId: string;
  readonly organizationId: string;
  readonly code: string;
  readonly name: string;
  readonly status: string;
}

function roleOf(member: OrganizationMember): OrgRole {
  if (!isOrgRole(member.role)) {
    // The CHECK constraint makes this unreachable.
    throw new ContractError("internal_error", "membership has an unknown role");
  }
  return member.role;
}

function safeMinor(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ContractError("internal_error", "amount exceeds the safe range");
  }
  return Number(value);
}

export function organizationView(
  org: Organization,
  myRole: OrgRole,
): OrganizationView {
  return {
    id: org.id,
    name: org.name,
    cityId: org.cityId,
    currency: org.currency,
    status: org.status,
    policy: {
      tripCap: {
        amountMinor: safeMinor(org.tripCapMinor),
        currency: org.currency,
      },
      allowedServices: [...org.allowedServices],
      allowedClasses: [...org.allowedClasses],
      version: org.policyVersion,
    },
    // The billing profile is the organization's commercial data: owners and
    // admins see it, bookers and travellers do not.
    billing: isAdminRole(myRole)
      ? { legalName: org.legalName, taxId: org.taxId }
      : null,
    myRole,
    version: org.version,
    createdAt: org.createdAt.toISOString(),
  };
}

function costCentreView(row: OrganizationCostCentre): CostCentreView {
  return {
    costCentreId: row.id,
    organizationId: row.organizationId,
    code: row.code,
    name: row.name,
    status: row.status,
  };
}

/**
 * `now`, when given, reports a pending invitation past its TTL as `expired`
 * — the row is never rewritten on expiry, and nobody can accept it.
 */
function invitationView(
  row: OrganizationInvitation,
  organizationName: string,
  now?: Date,
): InvitationView {
  if (!isOrgRole(row.role)) {
    throw new ContractError("internal_error", "invitation has an unknown role");
  }
  const lapsed =
    now !== undefined &&
    row.status === "pending" &&
    row.expiresAt.getTime() <= now.getTime();
  return {
    invitationId: row.id,
    organizationId: row.organizationId,
    organizationName,
    inviteeUserId: row.inviteeUserId,
    role: row.role,
    costCentreId: row.costCentreId,
    status: lapsed ? "expired" : row.status,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Display names for a set of members — first and last name, and NOTHING else
 * from the user row: no phone, no email, no status history.
 */
async function displayNames(
  tx: Tx,
  userIds: readonly string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(userIds)].filter((id) => UUID.test(id));
  if (ids.length === 0) {
    return new Map();
  }
  const users = await tx.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, firstName: true, lastName: true },
  });
  return new Map(
    users.map((user) => [user.id, `${user.firstName} ${user.lastName}`.trim()]),
  );
}

function memberView(
  member: OrganizationMember,
  names: ReadonlyMap<string, string>,
): MemberView {
  return {
    memberId: member.id,
    userId: member.userId,
    displayName: names.get(member.userId) ?? "",
    role: roleOf(member),
    status: member.status,
    costCentreId: member.costCentreId,
    joinedAt: member.createdAt.toISOString(),
  };
}

// ── Idempotency ───────────────────────────────────────────────────────────

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

/** A digest of what the request asked for — never its raw content. */
export function requestHashOf(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

/**
 * True when this idempotency key already produced its event (a replay). A
 * replay whose body differs from the original is refused — the caller reused
 * a key for a different change.
 */
async function isReplay(
  tx: Tx,
  eventKey: string,
  requestHash: string,
): Promise<boolean> {
  const prior = await findOutboxByIdempotencyKey(tx, eventKey);
  if (prior === undefined) {
    return false;
  }
  if (prior.requestHash !== requestHash) {
    throw new ContractError(
      "idempotency_key_reuse",
      "this Idempotency-Key was already used for a different change",
    );
  }
  return true;
}

function keyFor(
  name: OrgEventName,
  subjectId: string,
  actorId: string,
  clientKey: string,
): string {
  return eventIdempotencyKey(name, subjectId, actorId, clientKey);
}

// ── Loading and authority ─────────────────────────────────────────────────

/** Serializes every membership / policy change of one organization. */
async function lockOrganization(tx: Tx, orgId: string): Promise<Organization> {
  await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM organizations WHERE id = ${orgId} FOR UPDATE
  `;
  const org = await tx.organization.findUnique({ where: { id: orgId } });
  if (org === null) {
    throw new ContractError("not_found", "No such organization");
  }
  return org;
}

interface Membership {
  readonly org: Organization;
  readonly member: OrganizationMember;
  readonly role: OrgRole;
}

/**
 * The caller's ACTIVE membership, or `not_found` — a non-member cannot even
 * learn that the organization exists.
 */
async function membershipIn(
  tx: Tx,
  org: Organization | null,
  userId: string,
): Promise<Membership> {
  if (org === null) {
    throw new ContractError("not_found", "No such organization");
  }
  const member = await tx.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: org.id, userId } },
  });
  if (member === null || member.status !== "active") {
    throw new ContractError("not_found", "No such organization");
  }
  return { org, member, role: roleOf(member) };
}

async function readMembership(
  tx: Tx,
  orgId: string,
  userId: string,
): Promise<Membership> {
  const org = await tx.organization.findUnique({ where: { id: orgId } });
  return membershipIn(tx, org, userId);
}

function requireAdmin(membership: Membership): void {
  if (!isAdminRole(membership.role)) {
    throw new ContractError(
      "forbidden",
      "Only the organization's owners and admins can do that",
      { role: membership.role },
    );
  }
}

/**
 * May `actorRole` move a member from `fromRole` to `toRole` (or remove them,
 * when `toRole` is null)? Owners manage everyone; admins manage bookers and
 * travellers only, and cannot grant admin or owner.
 */
function assertCanManage(
  actorRole: OrgRole,
  fromRole: OrgRole,
  toRole: OrgRole | null,
): void {
  if (actorRole === "owner") {
    return;
  }
  const manageable =
    actorRole === "admin" &&
    ADMIN_MANAGEABLE_ROLES.includes(fromRole) &&
    (toRole === null || ADMIN_MANAGEABLE_ROLES.includes(toRole));
  if (!manageable) {
    throw new ContractError(
      "forbidden",
      "Only an owner can manage owners and admins",
      { role: actorRole, memberRole: fromRole, requestedRole: toRole },
    );
  }
}

/**
 * May a member holding `role` (null: no active membership) grant `granted`
 * by invitation? The same rule as `assertCanManage`: owners grant any role,
 * admins bookers and travellers, nobody else anything.
 */
function canGrant(role: OrgRole | null, granted: OrgRole): boolean {
  if (role === "owner") {
    return true;
  }
  return role === "admin" && ADMIN_MANAGEABLE_ROLES.includes(granted);
}

/**
 * An invitation carries its inviter's authority, so it must not outlive it.
 * When a member is removed (or leaves) or is demoted, every pending
 * invitation they sent that their new standing can no longer grant is
 * revoked in the same transaction — otherwise a removed owner's pending
 * owner-invitation would still hand an accomplice the organization.
 * `acceptInvitation` re-checks the inviter's authority as well.
 */
async function revokeUngrantableInvitations(
  tx: Tx,
  org: Organization,
  inviterUserId: string,
  inviterRole: OrgRole | null,
  actor: OrgActor,
  now: Date,
): Promise<void> {
  const pending = await tx.organizationInvitation.findMany({
    where: {
      organizationId: org.id,
      invitedBy: inviterUserId,
      status: "pending",
      expiresAt: { gt: now },
    },
  });
  for (const invitation of pending) {
    if (isOrgRole(invitation.role) && canGrant(inviterRole, invitation.role)) {
      continue;
    }
    await tx.organizationInvitation.update({
      where: { id: invitation.id },
      data: { status: "revoked", respondedAt: now },
    });
    await writeAudit(tx, {
      actorId: actor.userId,
      actorRole: actor.role,
      action: "organization.invitation_revoked",
      subjectType: ORG_AUDIT_SUBJECT,
      subjectId: org.id,
      before: { invitationId: invitation.id, status: invitation.status },
      after: { invitationId: invitation.id, status: "revoked" },
      reason: "inviter_lost_authority",
    });
    await writeOrgEvent(tx, {
      name: "organization.invitation_revoked",
      subjectUserId: invitation.inviteeUserId,
      actorType: actorTypeFor(actor.role),
      actorId: actor.userId,
      idempotencyKey: eventIdempotencyKey(
        "organization.invitation_revoked",
        invitation.id,
      ),
      fromVersion: 1,
      toVersion: 2,
      cityId: org.cityId,
      occurredAt: now,
      payload: {
        organizationId: org.id,
        invitationId: invitation.id,
        reason: "inviter_lost_authority",
      },
    });
  }
}

async function assertKeepsAnOwner(
  tx: Tx,
  orgId: string,
  leaving: OrganizationMember,
): Promise<void> {
  if (leaving.role !== "owner") {
    return;
  }
  const owners = await tx.organizationMember.count({
    where: { organizationId: orgId, role: "owner", status: "active" },
  });
  if (owners <= 1) {
    throw new ContractError(
      "conflict",
      "An organization must keep at least one owner — make someone else an owner first",
    );
  }
}

async function requireActiveCostCentre(
  tx: Tx,
  orgId: string,
  costCentreId: string,
): Promise<OrganizationCostCentre> {
  const costCentre = await tx.organizationCostCentre.findUnique({
    where: { id: costCentreId },
  });
  if (
    costCentre === null ||
    costCentre.organizationId !== orgId ||
    costCentre.status !== "active"
  ) {
    throw new ContractError(
      "validation_failed",
      "That cost centre is not an active cost centre of this organization",
      { costCentreId },
    );
  }
  return costCentre;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  );
}

// ── Organizations ─────────────────────────────────────────────────────────

export interface Replayable<T> {
  readonly value: T;
  readonly replayed: boolean;
}

/**
 * Creates an organization with the caller as its first owner. The policy
 * starts closed (zero cap, nothing allowed) and there is no money yet: the
 * organization spends only what is later topped up and allocated.
 */
export async function createOrganization(
  deps: OrganizationDeps,
  actor: OrgActor,
  input: CreateOrganizationInput,
  clientKey: string,
): Promise<Replayable<OrganizationView>> {
  const now = deps.now();
  const id = deterministicId("org", actor.userId, clientKey);

  const replayOf = (org: Organization): Replayable<OrganizationView> => {
    const same =
      org.createdBy === actor.userId &&
      org.name === input.name &&
      org.cityId === input.cityId &&
      org.legalName === (input.legalName ?? null) &&
      org.taxId === (input.taxId ?? null);
    if (!same) {
      throw new ContractError(
        "idempotency_key_reuse",
        "this Idempotency-Key already created a different organization",
      );
    }
    return { value: organizationView(org, "owner"), replayed: true };
  };

  try {
    return await deps.prisma.$transaction(async (tx) => {
      const existing = await tx.organization.findUnique({ where: { id } });
      if (existing !== null) {
        return replayOf(existing);
      }

      await assertBusinessTravelEnabled(tx, input.cityId);
      const city = await loadOrgCity(tx, input.cityId);

      const org = await tx.organization.create({
        data: {
          id,
          name: input.name,
          cityId: city.cityId,
          currency: city.currency,
          status: "active",
          legalName: input.legalName ?? null,
          taxId: input.taxId ?? null,
          tripCapMinor: BigInt(0),
          allowedServices: [],
          allowedClasses: [],
          createdBy: actor.userId,
        },
      });
      await tx.organizationMember.create({
        data: {
          id: deterministicId("orgm", org.id, actor.userId),
          organizationId: org.id,
          userId: actor.userId,
          role: "owner",
          status: "active",
          addedBy: actor.userId,
        },
      });

      await writeAudit(tx, {
        actorId: actor.userId,
        actorRole: actor.role,
        action: "organization.created",
        subjectType: ORG_AUDIT_SUBJECT,
        subjectId: org.id,
        after: {
          cityId: org.cityId,
          currency: org.currency,
          status: org.status,
          ownerId: actor.userId,
          policyVersion: org.policyVersion,
        } satisfies Prisma.InputJsonValue,
      });
      await writeOrgEvent(tx, {
        name: "organization.created",
        subjectUserId: actor.userId,
        actorType: actorTypeFor(actor.role),
        actorId: actor.userId,
        idempotencyKey: eventIdempotencyKey("organization.created", org.id),
        fromVersion: null,
        toVersion: org.version,
        cityId: org.cityId,
        occurredAt: now,
        payload: {
          organizationId: org.id,
          ownerId: actor.userId,
          currency: org.currency,
        },
      });

      return { value: organizationView(org, "owner"), replayed: false };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      // A concurrent request with the same key won the insert.
      const winner = await deps.prisma.organization.findUnique({
        where: { id },
      });
      if (winner !== null) {
        return replayOf(winner);
      }
    }
    throw error;
  }
}

/** The organizations the caller is an ACTIVE member of, with their role. */
export async function listMyOrganizations(
  deps: OrganizationDeps,
  actor: OrgActor,
): Promise<OrganizationView[]> {
  const memberships = await deps.prisma.organizationMember.findMany({
    where: { userId: actor.userId, status: "active" },
    include: { organization: true },
    orderBy: { createdAt: "asc" },
  });
  return memberships.map((membership) =>
    organizationView(membership.organization, roleOf(membership)),
  );
}

export async function getOrganization(
  deps: OrganizationDeps,
  actor: OrgActor,
  orgId: string,
): Promise<OrganizationView> {
  const membership = await readMembership(deps.prisma, orgId, actor.userId);
  return organizationView(membership.org, membership.role);
}

/**
 * Replaces the travel policy. The edit names the policy version it was made
 * against; a stale version is `version_conflict` rather than a silent
 * overwrite of another admin's change.
 */
export async function updatePolicy(
  deps: OrganizationDeps,
  actor: OrgActor,
  orgId: string,
  input: UpdatePolicyInput,
  clientKey: string,
): Promise<OrganizationView> {
  const now = deps.now();
  const allowedServices = [...new Set(input.allowedServices)].sort();
  const allowedClasses = [...new Set(input.allowedClasses)].sort();
  const hash = requestHashOf({
    op: "policy",
    tripCapMinor: input.tripCapMinor,
    allowedServices,
    allowedClasses,
    expectedPolicyVersion: input.expectedPolicyVersion,
  });
  const eventKey = keyFor(
    "organization.policy_updated",
    orgId,
    actor.userId,
    clientKey,
  );

  const result = await deps.prisma.$transaction(async (tx) => {
    const org = await lockOrganization(tx, orgId);
    const membership = await membershipIn(tx, org, actor.userId);
    requireAdmin(membership);
    if (await isReplay(tx, eventKey, hash)) {
      return organizationView(org, membership.role);
    }
    if (org.policyVersion !== input.expectedPolicyVersion) {
      throw new ContractError(
        "version_conflict",
        "The policy changed since you loaded it — reload and try again",
        {
          policyVersion: org.policyVersion,
          expectedPolicyVersion: input.expectedPolicyVersion,
        },
      );
    }

    const updated = await tx.organization.update({
      where: { id: orgId },
      data: {
        tripCapMinor: BigInt(input.tripCapMinor),
        allowedServices,
        allowedClasses,
        policyVersion: { increment: 1 },
        version: { increment: 1 },
      },
    });

    await writeAudit(tx, {
      actorId: actor.userId,
      actorRole: actor.role,
      action: "organization.policy_updated",
      subjectType: ORG_AUDIT_SUBJECT,
      subjectId: orgId,
      before: {
        tripCapMinor: safeMinor(org.tripCapMinor),
        allowedServices: org.allowedServices,
        allowedClasses: org.allowedClasses,
        policyVersion: org.policyVersion,
      } satisfies Prisma.InputJsonValue,
      after: {
        tripCapMinor: input.tripCapMinor,
        allowedServices,
        allowedClasses,
        policyVersion: updated.policyVersion,
      } satisfies Prisma.InputJsonValue,
    });
    await writeOrgEvent(tx, {
      name: "organization.policy_updated",
      subjectUserId: actor.userId,
      actorType: actorTypeFor(actor.role),
      actorId: actor.userId,
      idempotencyKey: eventKey,
      fromVersion: org.version,
      toVersion: updated.version,
      cityId: org.cityId,
      occurredAt: now,
      payload: {
        organizationId: orgId,
        policyVersion: updated.policyVersion,
        tripCapMinor: input.tripCapMinor,
        currency: org.currency,
        allowedServices,
        allowedClasses,
        requestHash: hash,
      },
    });
    return organizationView(updated, membership.role);
  });
  return result;
}

export async function updateBilling(
  deps: OrganizationDeps,
  actor: OrgActor,
  orgId: string,
  input: UpdateBillingInput,
  clientKey: string,
): Promise<OrganizationView> {
  const now = deps.now();
  const hash = requestHashOf({ op: "billing", ...input });
  const eventKey = keyFor(
    "organization.billing_updated",
    orgId,
    actor.userId,
    clientKey,
  );

  const result = await deps.prisma.$transaction(async (tx) => {
    const org = await lockOrganization(tx, orgId);
    const membership = await membershipIn(tx, org, actor.userId);
    requireAdmin(membership);
    if (await isReplay(tx, eventKey, hash)) {
      return organizationView(org, membership.role);
    }

    const updated = await tx.organization.update({
      where: { id: orgId },
      data: {
        legalName: input.legalName,
        taxId: input.taxId,
        version: { increment: 1 },
      },
    });
    await writeAudit(tx, {
      actorId: actor.userId,
      actorRole: actor.role,
      action: "organization.billing_updated",
      subjectType: ORG_AUDIT_SUBJECT,
      subjectId: orgId,
      before: {
        legalName: org.legalName,
        taxId: org.taxId,
      } satisfies Prisma.InputJsonValue,
      after: {
        legalName: updated.legalName,
        taxId: updated.taxId,
      } satisfies Prisma.InputJsonValue,
    });
    await writeOrgEvent(tx, {
      name: "organization.billing_updated",
      subjectUserId: actor.userId,
      actorType: actorTypeFor(actor.role),
      actorId: actor.userId,
      idempotencyKey: eventKey,
      fromVersion: org.version,
      toVersion: updated.version,
      cityId: org.cityId,
      occurredAt: now,
      payload: { organizationId: orgId, requestHash: hash },
    });
    return organizationView(updated, membership.role);
  });
  return result;
}

// ── Cost centres ──────────────────────────────────────────────────────────

/** Every active member may list them: a booking has to name one. */
export async function listCostCentres(
  deps: OrganizationDeps,
  actor: OrgActor,
  orgId: string,
): Promise<CostCentreView[]> {
  await readMembership(deps.prisma, orgId, actor.userId);
  const rows = await deps.prisma.organizationCostCentre.findMany({
    where: { organizationId: orgId },
    orderBy: { code: "asc" },
  });
  return rows.map(costCentreView);
}

export async function createCostCentre(
  deps: OrganizationDeps,
  actor: OrgActor,
  orgId: string,
  input: CreateCostCentreInput,
  clientKey: string,
): Promise<Replayable<CostCentreView>> {
  const now = deps.now();
  const id = deterministicId("occ", orgId, actor.userId, clientKey);

  const replayOf = (
    row: OrganizationCostCentre,
  ): Replayable<CostCentreView> => {
    if (
      row.organizationId !== orgId ||
      row.code !== input.code ||
      row.name !== input.name
    ) {
      throw new ContractError(
        "idempotency_key_reuse",
        "this Idempotency-Key already created a different cost centre",
      );
    }
    return { value: costCentreView(row), replayed: true };
  };

  try {
    return await deps.prisma.$transaction(async (tx) => {
      const org = await lockOrganization(tx, orgId);
      const membership = await membershipIn(tx, org, actor.userId);
      requireAdmin(membership);
      const existing = await tx.organizationCostCentre.findUnique({
        where: { id },
      });
      if (existing !== null) {
        return replayOf(existing);
      }
      const clash = await tx.organizationCostCentre.findUnique({
        where: {
          organizationId_code: { organizationId: orgId, code: input.code },
        },
      });
      if (clash !== null) {
        throw new ContractError(
          "conflict",
          "This organization already has a cost centre with that code",
          { code: input.code, costCentreId: clash.id },
        );
      }

      const row = await tx.organizationCostCentre.create({
        data: {
          id,
          organizationId: orgId,
          code: input.code,
          name: input.name,
          status: "active",
          createdBy: actor.userId,
        },
      });
      await writeAudit(tx, {
        actorId: actor.userId,
        actorRole: actor.role,
        action: "organization.cost_centre_created",
        subjectType: ORG_AUDIT_SUBJECT,
        subjectId: orgId,
        after: {
          costCentreId: row.id,
          code: row.code,
          status: row.status,
        } satisfies Prisma.InputJsonValue,
      });
      await writeOrgEvent(tx, {
        name: "organization.cost_centre_created",
        subjectUserId: actor.userId,
        actorType: actorTypeFor(actor.role),
        actorId: actor.userId,
        idempotencyKey: eventIdempotencyKey(
          "organization.cost_centre_created",
          row.id,
        ),
        fromVersion: null,
        toVersion: 1,
        cityId: org.cityId,
        occurredAt: now,
        payload: { organizationId: orgId, costCentreId: row.id },
      });
      return { value: costCentreView(row), replayed: false };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const winner = await deps.prisma.organizationCostCentre.findUnique({
        where: { id },
      });
      if (winner !== null) {
        return replayOf(winner);
      }
      throw new ContractError(
        "conflict",
        "This organization already has a cost centre with that code",
        { code: input.code },
      );
    }
    throw error;
  }
}

/**
 * Archives a cost centre: new bookings can no longer be charged to it, while
 * past bookings and statements keep resolving it. Never deleted.
 */
export async function archiveCostCentre(
  deps: OrganizationDeps,
  actor: OrgActor,
  orgId: string,
  costCentreId: string,
  clientKey: string,
): Promise<CostCentreView> {
  const now = deps.now();
  const hash = requestHashOf({ op: "archive", costCentreId });
  const eventKey = keyFor(
    "organization.cost_centre_archived",
    costCentreId,
    actor.userId,
    clientKey,
  );

  const result = await deps.prisma.$transaction(async (tx) => {
    const org = await lockOrganization(tx, orgId);
    const membership = await membershipIn(tx, org, actor.userId);
    requireAdmin(membership);
    const row = await tx.organizationCostCentre.findUnique({
      where: { id: costCentreId },
    });
    if (row === null || row.organizationId !== orgId) {
      throw new ContractError("not_found", "No such cost centre");
    }
    if (await isReplay(tx, eventKey, hash)) {
      return costCentreView(row);
    }
    if (row.status !== "active") {
      throw new ContractError(
        "illegal_transition",
        "That cost centre is already archived",
        { status: row.status },
      );
    }

    const updated = await tx.organizationCostCentre.update({
      where: { id: costCentreId },
      data: { status: "archived" },
    });
    await writeAudit(tx, {
      actorId: actor.userId,
      actorRole: actor.role,
      action: "organization.cost_centre_archived",
      subjectType: ORG_AUDIT_SUBJECT,
      subjectId: orgId,
      before: { costCentreId, status: row.status },
      after: { costCentreId, status: updated.status },
    });
    await writeOrgEvent(tx, {
      name: "organization.cost_centre_archived",
      subjectUserId: actor.userId,
      actorType: actorTypeFor(actor.role),
      actorId: actor.userId,
      idempotencyKey: eventKey,
      fromVersion: 1,
      toVersion: 2,
      cityId: org.cityId,
      occurredAt: now,
      payload: { organizationId: orgId, costCentreId, requestHash: hash },
    });
    return costCentreView(updated);
  });
  return result;
}

// ── Members ───────────────────────────────────────────────────────────────

/**
 * Who sees whom: owners and admins see every membership (including removed
 * ones, for the audit trail); a booker sees the ACTIVE members — the people
 * they may book for; a traveller sees only themselves. Views carry a display
 * name and role, never contact details.
 */
export async function listMembers(
  deps: OrganizationDeps,
  actor: OrgActor,
  orgId: string,
): Promise<MemberView[]> {
  const membership = await readMembership(deps.prisma, orgId, actor.userId);
  let where: Prisma.OrganizationMemberWhereInput = {
    organizationId: orgId,
    userId: actor.userId,
  };
  if (isAdminRole(membership.role)) {
    where = { organizationId: orgId };
  } else if (ORG_BOOKER_ROLES.includes(membership.role)) {
    where = { organizationId: orgId, status: "active" };
  }
  const members = await deps.prisma.organizationMember.findMany({
    where,
    orderBy: { createdAt: "asc" },
  });
  const names = await displayNames(
    deps.prisma,
    members.map((member) => member.userId),
  );
  return members.map((member) => memberView(member, names));
}

export async function updateMember(
  deps: OrganizationDeps,
  actor: OrgActor,
  orgId: string,
  memberId: string,
  input: UpdateMemberInput,
  clientKey: string,
): Promise<MemberView> {
  const now = deps.now();
  const hash = requestHashOf({ op: "member", memberId, ...input });
  const eventKey = keyFor(
    "organization.member_updated",
    memberId,
    actor.userId,
    clientKey,
  );

  const result = await deps.prisma.$transaction(async (tx) => {
    const org = await lockOrganization(tx, orgId);
    const membership = await membershipIn(tx, org, actor.userId);
    const target = await tx.organizationMember.findUnique({
      where: { id: memberId },
    });
    if (target === null || target.organizationId !== orgId) {
      throw new ContractError("not_found", "No such member");
    }
    if (await isReplay(tx, eventKey, hash)) {
      const names = await displayNames(tx, [target.userId]);
      return memberView(target, names);
    }
    if (target.status !== "active") {
      throw new ContractError(
        "illegal_transition",
        "That member has been removed; invite them again instead",
      );
    }

    const fromRole = roleOf(target);
    const toRole = input.role ?? fromRole;
    assertCanManage(membership.role, fromRole, toRole);
    if (fromRole === "owner" && toRole !== "owner") {
      await assertKeepsAnOwner(tx, orgId, target);
    }
    if (input.costCentreId !== undefined && input.costCentreId !== null) {
      await requireActiveCostCentre(tx, orgId, input.costCentreId);
    }

    const updated = await tx.organizationMember.update({
      where: { id: memberId },
      data: {
        role: toRole,
        ...(input.costCentreId === undefined
          ? {}
          : { costCentreId: input.costCentreId }),
        version: { increment: 1 },
      },
    });
    await writeAudit(tx, {
      actorId: actor.userId,
      actorRole: actor.role,
      action: "organization.member_updated",
      subjectType: ORG_AUDIT_SUBJECT,
      subjectId: orgId,
      before: {
        memberId,
        userId: target.userId,
        role: fromRole,
        costCentreId: target.costCentreId,
      },
      after: {
        memberId,
        userId: target.userId,
        role: toRole,
        costCentreId: updated.costCentreId,
      },
    });
    await writeOrgEvent(tx, {
      name: "organization.member_updated",
      subjectUserId: target.userId,
      actorType: actorTypeFor(actor.role),
      actorId: actor.userId,
      idempotencyKey: eventKey,
      fromVersion: target.version,
      toVersion: updated.version,
      cityId: org.cityId,
      occurredAt: now,
      payload: {
        organizationId: orgId,
        memberId,
        role: toRole,
        costCentreId: updated.costCentreId,
        requestHash: hash,
      },
    });
    if (toRole !== fromRole) {
      await revokeUngrantableInvitations(
        tx,
        org,
        target.userId,
        toRole,
        actor,
        now,
      );
    }
    const names = await displayNames(tx, [updated.userId]);
    return memberView(updated, names);
  });
  return result;
}

/**
 * Removes a member — or lets a member leave. The row is kept (status
 * `removed`) so past bookings and the audit trail still resolve; their
 * authority ends with this transaction, which payment-service observes on
 * the next reservation (it re-reads the membership in its own transaction).
 */
export async function removeMember(
  deps: OrganizationDeps,
  actor: OrgActor,
  orgId: string,
  memberId: string,
  clientKey: string,
): Promise<MemberView> {
  const now = deps.now();
  const hash = requestHashOf({ op: "remove", memberId });
  const eventKey = keyFor(
    "organization.member_removed",
    memberId,
    actor.userId,
    clientKey,
  );

  const result = await deps.prisma.$transaction(async (tx) => {
    const org = await lockOrganization(tx, orgId);
    const membership = await membershipIn(tx, org, actor.userId);
    const target = await tx.organizationMember.findUnique({
      where: { id: memberId },
    });
    if (target === null || target.organizationId !== orgId) {
      throw new ContractError("not_found", "No such member");
    }
    if (await isReplay(tx, eventKey, hash)) {
      const names = await displayNames(tx, [target.userId]);
      return memberView(target, names);
    }
    if (target.status !== "active") {
      throw new ContractError(
        "illegal_transition",
        "That member has already been removed",
      );
    }
    const leaving = target.userId === actor.userId;
    if (!leaving) {
      assertCanManage(membership.role, roleOf(target), null);
    }
    await assertKeepsAnOwner(tx, orgId, target);

    const updated = await tx.organizationMember.update({
      where: { id: memberId },
      data: { status: "removed", removedAt: now, version: { increment: 1 } },
    });
    await writeAudit(tx, {
      actorId: actor.userId,
      actorRole: actor.role,
      action: "organization.member_removed",
      subjectType: ORG_AUDIT_SUBJECT,
      subjectId: orgId,
      before: { memberId, userId: target.userId, status: target.status },
      after: {
        memberId,
        userId: target.userId,
        status: updated.status,
        left: leaving,
      },
    });
    await writeOrgEvent(tx, {
      name: "organization.member_removed",
      subjectUserId: target.userId,
      actorType: actorTypeFor(actor.role),
      actorId: actor.userId,
      idempotencyKey: eventKey,
      fromVersion: target.version,
      toVersion: updated.version,
      cityId: org.cityId,
      occurredAt: now,
      payload: {
        organizationId: orgId,
        memberId,
        left: leaving,
        requestHash: hash,
      },
    });
    await revokeUngrantableInvitations(
      tx,
      org,
      target.userId,
      null,
      actor,
      now,
    );
    const names = await displayNames(tx, [updated.userId]);
    return memberView(updated, names);
  });
  return result;
}

// ── Invitations ───────────────────────────────────────────────────────────

/**
 * Invites an EXISTING UBI user, found by phone number, to a role. Owners may
 * invite any role; admins may invite bookers and travellers. The invitation
 * is bound to that user and grants nothing until they accept it.
 */
export async function inviteMember(
  deps: OrganizationDeps,
  actor: OrgActor,
  orgId: string,
  input: InviteMemberInput,
  clientKey: string,
): Promise<Replayable<InvitationView>> {
  const now = deps.now();
  const scopedKey = `organization.invite:${actor.userId}:${clientKey}`;

  const replayOf = (
    row: OrganizationInvitation,
    inviteeUserId: string | null,
    orgName: string,
  ): Replayable<InvitationView> => {
    if (
      row.organizationId !== orgId ||
      row.role !== input.role ||
      row.costCentreId !== (input.costCentreId ?? null) ||
      (inviteeUserId !== null && row.inviteeUserId !== inviteeUserId)
    ) {
      throw new ContractError(
        "idempotency_key_reuse",
        "this Idempotency-Key already sent a different invitation",
      );
    }
    return { value: invitationView(row, orgName), replayed: true };
  };

  const resolveInvitee = async (tx: Tx): Promise<string | null> => {
    const user = await tx.user.findUnique({
      where: { phone: input.phone },
      select: { id: true, status: true, deletedAt: true },
    });
    return user === null || user.deletedAt !== null || user.status !== "ACTIVE"
      ? null
      : user.id;
  };

  try {
    return await deps.prisma.$transaction(async (tx) => {
      const org = await lockOrganization(tx, orgId);
      const membership = await membershipIn(tx, org, actor.userId);
      requireAdmin(membership);

      const inviteeUserId = await resolveInvitee(tx);
      const existing = await tx.organizationInvitation.findUnique({
        where: { idempotencyKey: scopedKey },
      });
      if (existing !== null) {
        return replayOf(existing, inviteeUserId, org.name);
      }

      await assertBusinessTravelEnabled(tx, org.cityId);
      if (org.status !== "active") {
        throw new ContractError(
          "conflict",
          "This organization is suspended and cannot invite members",
        );
      }
      assertCanManage(membership.role, "traveller", input.role);
      if (inviteeUserId === null) {
        throw new ContractError(
          "recipient_not_found",
          "No UBI account uses that number",
        );
      }

      const current = await tx.organizationMember.findUnique({
        where: {
          organizationId_userId: {
            organizationId: orgId,
            userId: inviteeUserId,
          },
        },
      });
      if (current !== null && current.status === "active") {
        throw new ContractError(
          "conflict",
          "That person is already a member of this organization",
          { memberId: current.id },
        );
      }
      const pending = await tx.organizationInvitation.findFirst({
        where: {
          organizationId: orgId,
          inviteeUserId,
          status: "pending",
          expiresAt: { gt: now },
        },
      });
      if (pending !== null) {
        throw new ContractError(
          "conflict",
          "That person already has a pending invitation to this organization",
          { invitationId: pending.id },
        );
      }
      if (input.costCentreId !== undefined) {
        await requireActiveCostCentre(tx, orgId, input.costCentreId);
      }

      const invitation = await tx.organizationInvitation.create({
        data: {
          id: deterministicId("orgi", scopedKey),
          organizationId: orgId,
          inviteeUserId,
          role: input.role,
          costCentreId: input.costCentreId ?? null,
          status: "pending",
          invitedBy: actor.userId,
          idempotencyKey: scopedKey,
          expiresAt: new Date(
            now.getTime() + ORG_INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000,
          ),
        },
      });
      await writeAudit(tx, {
        actorId: actor.userId,
        actorRole: actor.role,
        action: "organization.member_invited",
        subjectType: ORG_AUDIT_SUBJECT,
        subjectId: orgId,
        // The invitee's id, never the phone number that found them.
        after: {
          invitationId: invitation.id,
          inviteeUserId,
          role: invitation.role,
          costCentreId: invitation.costCentreId,
          expiresAt: invitation.expiresAt.toISOString(),
        },
      });
      await writeOrgEvent(tx, {
        name: "organization.member_invited",
        subjectUserId: inviteeUserId,
        actorType: actorTypeFor(actor.role),
        actorId: actor.userId,
        idempotencyKey: eventIdempotencyKey(
          "organization.member_invited",
          invitation.id,
        ),
        fromVersion: null,
        toVersion: 1,
        cityId: org.cityId,
        occurredAt: now,
        payload: {
          organizationId: orgId,
          invitationId: invitation.id,
          role: invitation.role,
          expiresAt: invitation.expiresAt.toISOString(),
        },
      });
      return { value: invitationView(invitation, org.name), replayed: false };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const winner = await deps.prisma.organizationInvitation.findUnique({
        where: { idempotencyKey: scopedKey },
        include: { organization: true },
      });
      if (winner !== null) {
        return replayOf(winner, null, winner.organization.name);
      }
    }
    throw error;
  }
}

/** The organization's invitations, for its owners and admins. */
export async function listOrganizationInvitations(
  deps: OrganizationDeps,
  actor: OrgActor,
  orgId: string,
): Promise<InvitationView[]> {
  const membership = await readMembership(deps.prisma, orgId, actor.userId);
  requireAdmin(membership);
  const rows = await deps.prisma.organizationInvitation.findMany({
    where: { organizationId: orgId },
    orderBy: { createdAt: "desc" },
  });
  const now = deps.now();
  return rows.map((row) => invitationView(row, membership.org.name, now));
}

/** The caller's own PENDING, unexpired invitations. */
export async function listMyInvitations(
  deps: OrganizationDeps,
  actor: OrgActor,
): Promise<InvitationView[]> {
  const rows = await deps.prisma.organizationInvitation.findMany({
    where: {
      inviteeUserId: actor.userId,
      status: "pending",
      expiresAt: { gt: deps.now() },
    },
    include: { organization: true },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((row) => invitationView(row, row.organization.name));
}

/**
 * Locks an invitation for a response. The lock order is the ORGANIZATION row
 * first, then the invitation — the same order every membership change uses —
 * so an accept racing a revoke or an invite cannot deadlock.
 */
async function lockInvitation(
  tx: Tx,
  invitationId: string,
): Promise<{ invitation: OrganizationInvitation; org: Organization }> {
  const peek = await tx.organizationInvitation.findUnique({
    where: { id: invitationId },
    select: { organizationId: true },
  });
  if (peek === null) {
    throw new ContractError("not_found", "No such invitation");
  }
  const org = await lockOrganization(tx, peek.organizationId);
  await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM organization_invitations WHERE id = ${invitationId} FOR UPDATE
  `;
  const invitation = await tx.organizationInvitation.findUnique({
    where: { id: invitationId },
  });
  if (invitation === null) {
    throw new ContractError("not_found", "No such invitation");
  }
  return { invitation, org };
}

export interface AcceptResult {
  readonly invitation: InvitationView;
  readonly member: MemberView;
}

/**
 * The invitee — and only the invitee — joins the organization. Accepting is
 * naturally idempotent: a second accept answers the membership it created.
 */
export async function acceptInvitation(
  deps: OrganizationDeps,
  actor: OrgActor,
  invitationId: string,
): Promise<Replayable<AcceptResult>> {
  const now = deps.now();

  const result = await deps.prisma.$transaction(async (tx) => {
    const { invitation, org } = await lockInvitation(tx, invitationId);
    // Someone else's invitation is indistinguishable from none at all.
    if (invitation.inviteeUserId !== actor.userId) {
      throw new ContractError("not_found", "No such invitation");
    }

    if (invitation.status === "accepted") {
      const member = await tx.organizationMember.findUnique({
        where: {
          organizationId_userId: {
            organizationId: org.id,
            userId: actor.userId,
          },
        },
      });
      if (member !== null) {
        const names = await displayNames(tx, [member.userId]);
        return {
          value: {
            invitation: invitationView(invitation, org.name),
            member: memberView(member, names),
          },
          replayed: true,
        };
      }
    }
    if (invitation.status !== "pending") {
      throw new ContractError(
        "illegal_transition",
        `This invitation is ${invitation.status}`,
        { status: invitation.status },
      );
    }
    if (invitation.expiresAt.getTime() <= now.getTime()) {
      throw new ContractError(
        "illegal_transition",
        "This invitation has expired — ask for a new one",
        { status: "expired" },
      );
    }
    if (org.status !== "active") {
      throw new ContractError(
        "conflict",
        "This organization is suspended and cannot take new members",
      );
    }
    if (!isOrgRole(invitation.role)) {
      throw new ContractError(
        "internal_error",
        "invitation has an unknown role",
      );
    }
    // The invitation grants only what its inviter may STILL grant: a removed
    // or demoted inviter's authority does not survive in their invitations
    // (removal and demotion revoke them; this is the backstop).
    const inviter = await tx.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: org.id,
          userId: invitation.invitedBy,
        },
      },
    });
    const inviterRole =
      inviter !== null && inviter.status === "active" && isOrgRole(inviter.role)
        ? inviter.role
        : null;
    if (!canGrant(inviterRole, invitation.role)) {
      throw new ContractError(
        "illegal_transition",
        "This invitation is no longer valid — ask the organization for a new one",
        { status: "revoked", reason: "inviter_not_authorized" },
      );
    }

    // A cost centre archived since the invite is dropped, not inherited.
    let costCentreId = invitation.costCentreId;
    if (costCentreId !== null) {
      const costCentre = await tx.organizationCostCentre.findUnique({
        where: { id: costCentreId },
      });
      if (costCentre === null || costCentre.status !== "active") {
        costCentreId = null;
      }
    }

    const prior = await tx.organizationMember.findUnique({
      where: {
        organizationId_userId: { organizationId: org.id, userId: actor.userId },
      },
    });
    if (prior !== null && prior.status === "active") {
      throw new ContractError(
        "conflict",
        "You are already a member of this organization",
      );
    }
    const member =
      prior === null
        ? await tx.organizationMember.create({
            data: {
              id: deterministicId("orgm", org.id, actor.userId),
              organizationId: org.id,
              userId: actor.userId,
              role: invitation.role,
              status: "active",
              costCentreId,
              addedBy: invitation.invitedBy,
            },
          })
        : await tx.organizationMember.update({
            where: { id: prior.id },
            data: {
              role: invitation.role,
              status: "active",
              costCentreId,
              removedAt: null,
              addedBy: invitation.invitedBy,
              version: { increment: 1 },
            },
          });
    const accepted = await tx.organizationInvitation.update({
      where: { id: invitation.id },
      data: { status: "accepted", respondedAt: now },
    });

    await writeAudit(tx, {
      actorId: actor.userId,
      actorRole: actor.role,
      action: "organization.invitation_accepted",
      subjectType: ORG_AUDIT_SUBJECT,
      subjectId: org.id,
      before: { invitationId: invitation.id, status: invitation.status },
      after: {
        invitationId: invitation.id,
        status: accepted.status,
        memberId: member.id,
        role: member.role,
      },
    });
    await writeOrgEvent(tx, {
      name: "organization.invitation_accepted",
      subjectUserId: actor.userId,
      actorType: actorTypeFor(actor.role),
      actorId: actor.userId,
      idempotencyKey: eventIdempotencyKey(
        "organization.invitation_accepted",
        invitation.id,
      ),
      fromVersion: prior?.version ?? null,
      toVersion: member.version,
      cityId: org.cityId,
      occurredAt: now,
      payload: {
        organizationId: org.id,
        invitationId: invitation.id,
        memberId: member.id,
        role: member.role,
      },
    });
    const names = await displayNames(tx, [member.userId]);
    return {
      value: {
        invitation: invitationView(accepted, org.name),
        member: memberView(member, names),
      },
      replayed: false,
    };
  });
  return result;
}

/** The invitee declines. Nothing is created; the organization is told. */
export async function declineInvitation(
  deps: OrganizationDeps,
  actor: OrgActor,
  invitationId: string,
): Promise<Replayable<InvitationView>> {
  const result = await respondAsOrganization(
    deps,
    actor,
    invitationId,
    "declined",
  );
  return result;
}

/** An owner or admin withdraws a pending invitation. */
export async function revokeInvitation(
  deps: OrganizationDeps,
  actor: OrgActor,
  orgId: string,
  invitationId: string,
): Promise<Replayable<InvitationView>> {
  const result = await respondAsOrganization(
    deps,
    actor,
    invitationId,
    "revoked",
    orgId,
  );
  return result;
}

async function respondAsOrganization(
  deps: OrganizationDeps,
  actor: OrgActor,
  invitationId: string,
  outcome: "declined" | "revoked",
  orgId?: string,
): Promise<Replayable<InvitationView>> {
  const now = deps.now();
  const eventName: OrgEventName =
    outcome === "declined"
      ? "organization.invitation_declined"
      : "organization.invitation_revoked";

  const result = await deps.prisma.$transaction(async (tx) => {
    const { invitation, org } = await lockInvitation(tx, invitationId);
    if (outcome === "declined") {
      if (invitation.inviteeUserId !== actor.userId) {
        throw new ContractError("not_found", "No such invitation");
      }
    } else {
      if (org.id !== orgId) {
        throw new ContractError("not_found", "No such invitation");
      }
      const membership = await membershipIn(tx, org, actor.userId);
      requireAdmin(membership);
      // Only someone who could grant the role may withdraw it: an admin
      // revokes booker and traveller invitations, owners any.
      if (
        !isOrgRole(invitation.role) ||
        !canGrant(membership.role, invitation.role)
      ) {
        throw new ContractError(
          "forbidden",
          "Only an owner can withdraw an owner or admin invitation",
          { role: membership.role, invitationRole: invitation.role },
        );
      }
    }

    if (invitation.status === outcome) {
      return { value: invitationView(invitation, org.name), replayed: true };
    }
    if (invitation.status !== "pending") {
      throw new ContractError(
        "illegal_transition",
        `This invitation is ${invitation.status}`,
        { status: invitation.status },
      );
    }

    const updated = await tx.organizationInvitation.update({
      where: { id: invitation.id },
      data: { status: outcome, respondedAt: now },
    });
    await writeAudit(tx, {
      actorId: actor.userId,
      actorRole: actor.role,
      action: eventName,
      subjectType: ORG_AUDIT_SUBJECT,
      subjectId: org.id,
      before: { invitationId: invitation.id, status: invitation.status },
      after: { invitationId: invitation.id, status: updated.status },
    });
    await writeOrgEvent(tx, {
      name: eventName,
      subjectUserId: invitation.inviteeUserId,
      actorType: actorTypeFor(actor.role),
      actorId: actor.userId,
      idempotencyKey: eventIdempotencyKey(eventName, invitation.id),
      fromVersion: 1,
      toVersion: 2,
      cityId: org.cityId,
      occurredAt: now,
      payload: { organizationId: org.id, invitationId: invitation.id },
    });
    return { value: invitationView(updated, org.name), replayed: false };
  });
  return result;
}
