/**
 * Who may do what with an organization's money — read, never written, from
 * the organization tables user-service owns (src/organizations there).
 *
 * Authority is derived HERE, inside the caller's transaction, from ACTIVE
 * memberships: a request names users, it never asserts their roles. When a
 * reservation depends on a membership, the membership row is read `FOR SHARE`
 * so a concurrent removal in user-service (an UPDATE of that row) waits for
 * the reservation to commit or roll back — the authorization and the money
 * move linearize, instead of a removed booker slipping one last booking in.
 */
import { ContractError, type FlagSet, isEnabled } from "@ubi/contracts";

import {
  BUSINESS_TRAVEL_FLAG,
  isOrgRole,
  ORG_BOOKER_ROLES,
  type OrgRole,
  refusal,
  type RefusalReason,
} from "./model";
import { fromDbMinor } from "../ledger/minor-units";

import type { LedgerTx } from "../ledger/types";

export interface OrgRecord {
  readonly id: string;
  readonly name: string;
  readonly cityId: string;
  readonly currency: string;
  readonly status: string;
  readonly legalName: string | null;
  readonly taxId: string | null;
  readonly tripCapMinor: number;
  readonly allowedServices: readonly string[];
  readonly allowedClasses: readonly string[];
  readonly policyVersion: number;
}

export async function loadOrganization(
  tx: LedgerTx,
  orgId: string,
): Promise<OrgRecord | null> {
  const org = await tx.organization.findUnique({ where: { id: orgId } });
  if (org === null) {
    return null;
  }
  return {
    id: org.id,
    name: org.name,
    cityId: org.cityId,
    currency: org.currency,
    status: org.status,
    legalName: org.legalName,
    taxId: org.taxId,
    tripCapMinor: fromDbMinor(org.tripCapMinor),
    allowedServices: org.allowedServices,
    allowedClasses: org.allowedClasses,
    policyVersion: org.policyVersion,
  };
}

/**
 * The user's ACTIVE role in the organization, or null. `share` takes a
 * `FOR SHARE` row lock on the membership for the rest of the transaction.
 */
export async function activeRole(
  tx: LedgerTx,
  orgId: string,
  userId: string,
  options: { readonly share?: boolean } = {},
): Promise<{ role: OrgRole; costCentreId: string | null } | null> {
  const rows = options.share
    ? await tx.$queryRaw<
        Array<{ role: string; status: string; cost_centre_id: string | null }>
      >`
        SELECT role, status, cost_centre_id FROM organization_members
        WHERE organization_id = ${orgId} AND user_id = ${userId}
        FOR SHARE
      `
    : await tx.$queryRaw<
        Array<{ role: string; status: string; cost_centre_id: string | null }>
      >`
        SELECT role, status, cost_centre_id FROM organization_members
        WHERE organization_id = ${orgId} AND user_id = ${userId}
      `;
  const row = rows[0];
  if (row === undefined || row.status !== "active" || !isOrgRole(row.role)) {
    return null;
  }
  return { role: row.role, costCentreId: row.cost_centre_id };
}

/**
 * The caller's organization and role, or `not_found` for a non-member (who
 * must not learn the organization exists) and `forbidden` for a member whose
 * role does not allow the operation.
 */
export async function requireOrgRole(
  tx: LedgerTx,
  orgId: string,
  userId: string,
  allowed: readonly OrgRole[],
): Promise<{ org: OrgRecord; role: OrgRole }> {
  const org = await loadOrganization(tx, orgId);
  const membership = org === null ? null : await activeRole(tx, orgId, userId);
  if (org === null || membership === null) {
    throw new ContractError("not_found", "no such organization");
  }
  if (!allowed.includes(membership.role)) {
    throw new ContractError(
      "forbidden",
      "your role in this organization does not allow that",
      { role: membership.role },
    );
  }
  return { org, role: membership.role };
}

/**
 * The per-city `business_travel` flag, read through the registered FlagKey
 * (the contract's `isEnabled`); an absent or unreadable flag is OFF.
 */
export function businessTravelOn(flags: FlagSet): boolean {
  return isEnabled(flags, BUSINESS_TRAVEL_FLAG);
}

export function assertBusinessTravelOn(flags: FlagSet, cityId: string): void {
  if (!businessTravelOn(flags)) {
    throw refusal("feature_disabled", {
      feature: BUSINESS_TRAVEL_FLAG,
      cityId,
    });
  }
}

export interface CostCentreRecord {
  readonly id: string;
  readonly code: string;
  readonly status: string;
  readonly organizationId: string;
}

export async function activeCostCentre(
  tx: LedgerTx,
  orgId: string,
  costCentreId: string | null,
): Promise<CostCentreRecord | null> {
  if (costCentreId === null) {
    return null;
  }
  const row = await tx.organizationCostCentre.findUnique({
    where: { id: costCentreId },
  });
  if (row === null || row.organizationId !== orgId || row.status !== "active") {
    return null;
  }
  return row;
}

export interface BookingParties {
  readonly bookerId: string;
  readonly travellerId: string;
  readonly costCentreId?: string | undefined;
  readonly service: string;
  readonly vehicleClass: string;
  readonly amountMinor: number;
  readonly currency: string;
}

export interface PolicyVerdict {
  readonly reasons: RefusalReason[];
  readonly costCentre: CostCentreRecord | null;
}

/**
 * Every reason the organization would refuse this booking, in a fixed order
 * (the first one is what a reservation throws). Budget availability is NOT
 * judged here — it needs the budget account's row lock (./reservations.ts).
 *
 * - the organization must be active;
 * - the booker must be an active owner/admin/booker — or the traveller
 *   booking for THEMSELVES with any active role;
 * - the traveller must be an active member (any role);
 * - the cost centre (named, or the traveller's default) must be an active
 *   cost centre of the organization;
 * - the service and vehicle class must be allowed, the amount within the
 *   per-trip cap, in the organization's currency. A new organization's policy
 *   allows nothing (deny-by-default).
 */
export async function evaluatePolicy(
  tx: LedgerTx,
  org: OrgRecord,
  parties: BookingParties,
  options: { readonly share: boolean },
): Promise<PolicyVerdict> {
  const reasons: RefusalReason[] = [];
  if (org.status !== "active") {
    reasons.push("organization_not_active");
  }

  const booker = await activeRole(tx, org.id, parties.bookerId, options);
  const traveller =
    parties.travellerId === parties.bookerId
      ? booker
      : await activeRole(tx, org.id, parties.travellerId, options);
  const selfBooking = parties.bookerId === parties.travellerId;
  const bookerMayBook =
    booker !== null && (selfBooking || ORG_BOOKER_ROLES.includes(booker.role));
  if (!bookerMayBook) {
    reasons.push("booker_not_authorized");
  }
  if (traveller === null) {
    reasons.push("traveller_not_member");
  }

  const costCentre = await activeCostCentre(
    tx,
    org.id,
    parties.costCentreId ?? traveller?.costCentreId ?? null,
  );
  if (costCentre === null) {
    reasons.push("cost_centre_invalid");
  }

  if (!org.allowedServices.includes(parties.service)) {
    reasons.push("service_not_allowed");
  }
  if (!org.allowedClasses.includes(parties.vehicleClass)) {
    reasons.push("class_not_allowed");
  }
  if (parties.currency !== org.currency) {
    reasons.push("currency_mismatch");
  } else if (parties.amountMinor > org.tripCapMinor) {
    reasons.push("trip_cap_exceeded");
  }
  return { reasons, costCentre };
}
